-- REVIEW ONLY. Phase A simulates objects inside PostgreSQL; no Storage bucket/API.
-- Run once in one transaction. A pre-existing schema/function is an error.
begin;
create schema qlist_photo_trial;
revoke all on schema qlist_photo_trial from public, anon, authenticated;
grant usage on schema qlist_photo_trial to service_role;

create table qlist_photo_trial.budgets (
  scope text primary key check (scope in ('global','PhotoDemo')),
  cap_bytes bigint not null default 10485760 check (cap_bytes between 1 and 10485760),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  photo_count integer not null default 0 check (photo_count between 0 and 20),
  pending_count integer not null default 0 check (pending_count between 0 and 2),
  operation_count integer not null default 0 check (operation_count between 0 and 100),
  item_count integer not null default 0 check (item_count between 0 and 100),
  read_bytes bigint not null default 0 check (read_bytes between 0 and 5242880),
  read_count integer not null default 0 check (read_count between 0 and 100),
  stopped boolean not null default false,
  expires_at timestamptz not null default (transaction_timestamp() + interval '24 hours'),
  check (used_bytes + reserved_bytes <= cap_bytes)
);
insert into qlist_photo_trial.budgets(scope) values ('global'),('PhotoDemo');
create table qlist_photo_trial.items (
  item_id text primary key check (item_id ~ '^trial-[a-z0-9-]{1,48}$'),
  list_id text not null default 'PhotoDemo' check (list_id = 'PhotoDemo'),
  epoch bigint not null default 0 check (epoch >= 0),
  version bigint not null default 0 check (version >= 0),
  current_operation text,
  deleted boolean not null default false,
  check (not deleted or current_operation is null)
);
create table qlist_photo_trial.operations (
  operation_id text primary key check (operation_id ~ '^phasea-[a-z0-9-]{1,64}$'),
  item_id text not null references qlist_photo_trial.items,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  fixture text not null check (fixture in ('gradient','portrait')),
  expected_version bigint not null check (expected_version >= 0),
  captured_epoch bigint not null check (captured_epoch >= 0),
  phase text not null check (phase in ('reserved','staged','committed','cleanup','released')),
  reserved_bytes integer not null default 425984 check (reserved_bytes = 425984),
  actual_bytes integer not null default 0 check (actual_bytes between 0 and 425984),
  holds_photo boolean not null,
  was_committed boolean not null default false,
  committed_version bigint,
  lease_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (was_committed = (committed_version is not null)),
  check (phase <> 'committed' or was_committed)
);
alter table qlist_photo_trial.items add constraint current_operation_fk
  foreign key (current_operation) references qlist_photo_trial.operations;
create index operations_item_idx on qlist_photo_trial.operations(item_id);
create table qlist_photo_trial.objects (
  operation_id text not null references qlist_photo_trial.operations,
  kind text not null check (kind in ('full','thumb')),
  object_key text generated always as ('phase-a/PhotoDemo/' || operation_id || '/' || kind || '.jpg') stored unique,
  size_bytes integer not null default 0,
  digest text check (digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'planned' check (state in ('planned','simulated-present','simulated-absent')),
  cleanup_verified_at timestamptz,
  primary key(operation_id,kind),
  check (size_bytes between 0 and case kind when 'full' then 393216 else 32768 end),
  check (state <> 'simulated-present' or (size_bytes > 0 and digest is not null)),
  check (cleanup_verified_at is null or state = 'simulated-absent')
);

-- No client policies. The existing service role bypasses RLS; other roles fail closed.
alter table qlist_photo_trial.budgets enable row level security;
alter table qlist_photo_trial.items enable row level security;
alter table qlist_photo_trial.operations enable row level security;
alter table qlist_photo_trial.objects enable row level security;
revoke all on all tables in schema qlist_photo_trial from public, anon, authenticated, service_role;
grant select, update on qlist_photo_trial.budgets to service_role;
grant select, insert, update on qlist_photo_trial.items, qlist_photo_trial.operations, qlist_photo_trial.objects to service_role;

-- Bounded scans (100 operations / 200 simulated objects) avoid drift-prone deltas.
-- Caller must hold global then list budget locks; only the RPC calls this helper.
create function qlist_photo_trial.reconcile() returns void
language plpgsql security invoker set search_path = '' as $$
declare u bigint; r bigint; p integer; a integer; n integer; i integer;
begin
 perform 1 from qlist_photo_trial.budgets where scope='global' for update;
 perform 1 from qlist_photo_trial.budgets where scope='PhotoDemo' for update;
 select coalesce(sum(actual_bytes) filter (where was_committed and phase <> 'released'),0),
        coalesce(sum(reserved_bytes) filter (where not was_committed and phase <> 'released'),0),
        count(*) filter (where not was_committed and phase <> 'released'), count(*)
 into u,r,a,n from qlist_photo_trial.operations;
 select count(*) into i from qlist_photo_trial.items;
 select (select count(*) from qlist_photo_trial.items where current_operation is not null)
        + count(*) filter (where holds_photo and not was_committed and phase <> 'released')
 into p from qlist_photo_trial.operations;
 update qlist_photo_trial.budgets set used_bytes=u,reserved_bytes=r,photo_count=p,
   pending_count=a,operation_count=n,item_count=i where scope in ('global','PhotoDemo');
end $$;
revoke all on function qlist_photo_trial.reconcile() from public, anon, authenticated;
grant execute on function qlist_photo_trial.reconcile() to service_role;

-- Sole public-schema API. INVOKER, explicit privileges, fixed synthetic list/IDs.
create function public.qlist_photo_trial_rpc(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '3s' set statement_timeout = '8s' as $$
declare
 b qlist_photo_trial.budgets%rowtype;
 op qlist_photo_trial.operations%rowtype;
 it qlist_photo_trial.items%rowtype;
 oid text := payload->>'operation_id';
 iid text := payload->>'item_id';
 fixture_name text := payload->>'fixture';
 expected bigint;
 fingerprint text;
 result jsonb;
 is_open boolean;
 old_id text;
 bytes_to_charge bigint;
begin
 if action is null or action not in ('reserve','stage','stage_partial','commit','cancel','expire','cleanup','remove','delete_item','status')
 then raise exception 'invalid_action'; end if;
 if jsonb_typeof(payload) is distinct from 'object' or pg_column_size(payload)>4096
 then raise exception 'invalid_payload'; end if;
 if payload ? 'list_id' and (payload->>'list_id') is distinct from 'PhotoDemo'
 then raise exception 'synthetic_list_only'; end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('list_id','operation_id','item_id','fixture','expected_version'))
 then raise exception 'unknown_field'; end if;
 -- All RPCs take these locks first, including read accounting and cleanup.
 perform 1 from qlist_photo_trial.budgets where scope='global' for update;
 perform 1 from qlist_photo_trial.budgets where scope='PhotoDemo' for update;
 if (select count(*) from qlist_photo_trial.budgets) <> 2 then raise exception 'budget_missing'; end if;
 select * into b from qlist_photo_trial.budgets where scope='global';
 select bool_and(not stopped and clock_timestamp()<expires_at) into is_open from qlist_photo_trial.budgets;
 if oid is not null and oid !~ '^phasea-[a-z0-9-]{1,64}$' then raise exception 'invalid_operation'; end if;
 if iid is not null and iid !~ '^trial-[a-z0-9-]{1,48}$' then raise exception 'invalid_item'; end if;
 if payload ? 'expected_version' then
   if (payload->>'expected_version') is null or (payload->>'expected_version') !~ '^[0-9]{1,12}$'
   then raise exception 'invalid_version'; end if;
   expected := (payload->>'expected_version')::bigint;
 end if;

 if action = 'reserve' then
   if oid is null or iid is null or expected is null or fixture_name is null or fixture_name not in ('gradient','portrait')
   then raise exception 'invalid_reservation'; end if;
   fingerprint := encode(sha256(convert_to(jsonb_build_array('PhotoDemo',iid,fixture_name,expected,425984)::text,'UTF8')),'hex');
   select * into op from qlist_photo_trial.operations where operation_id=oid;
   if found then
     if op.request_digest<>fingerprint then raise exception 'idempotency_conflict'; end if;
   else
     if not is_open then raise exception 'trial_closed'; end if;
     insert into qlist_photo_trial.items(item_id) values(iid) on conflict do nothing;
     select * into it from qlist_photo_trial.items where item_id=iid for update;
     if it.deleted then raise exception 'item_deleted'; end if;
     if (case when it.current_operation is null then 0 else it.version end)<>expected
     then raise exception 'version_conflict'; end if;
     insert into qlist_photo_trial.operations(operation_id,item_id,request_digest,fixture,expected_version,captured_epoch,phase,holds_photo,lease_until)
       values(oid,iid,fingerprint,fixture_name,expected,it.epoch,'reserved',it.current_operation is null,
              least(clock_timestamp()+interval '60 seconds',b.expires_at));
     insert into qlist_photo_trial.objects(operation_id,kind) values(oid,'full'),(oid,'thumb');
   end if;
 elsif action in ('stage','stage_partial','commit','cancel','cleanup') then
   select * into op from qlist_photo_trial.operations where operation_id=oid;
   if not found then raise exception 'unknown_operation'; end if;
   select * into it from qlist_photo_trial.items where item_id=op.item_id for update;
   if action in ('stage','stage_partial') then
     if not is_open or clock_timestamp()>=op.lease_until then raise exception 'lease_closed'; end if;
     if it.deleted or it.epoch<>op.captured_epoch then raise exception 'item_fenced'; end if;
     if op.phase not in ('reserved','staged') then raise exception 'invalid_phase'; end if;
     -- No network writer exists in Phase A. These are simulated fixture sizes/hashes.
     update qlist_photo_trial.objects set state='simulated-present',
       size_bytes=case when kind='full' then case op.fixture when 'gradient' then 19896 else 15445 end
                       else case op.fixture when 'gradient' then 1316 else 1003 end end,
       digest=encode(sha256(convert_to('SIMULATED:'||op.fixture||':'||kind,'UTF8')),'hex')
       where operation_id=oid and (action='stage' or kind='full');
     update qlist_photo_trial.operations set
       actual_bytes=(select sum(size_bytes) from qlist_photo_trial.objects where operation_id=oid),
       phase=case when (select count(*) from qlist_photo_trial.objects where operation_id=oid and state='simulated-present')=2 then 'staged' else 'reserved' end
       where operation_id=oid;
   elsif action='commit' then
     if not op.was_committed then
       if not is_open or clock_timestamp()>=op.lease_until then raise exception 'lease_closed'; end if;
       if op.phase<>'staged' then raise exception 'not_staged'; end if;
       if it.deleted or it.epoch<>op.captured_epoch or
          (case when it.current_operation is null then 0 else it.version end)<>op.expected_version
       then raise exception 'version_conflict'; end if;
       old_id := it.current_operation;
       update qlist_photo_trial.operations set phase='cleanup' where operation_id=old_id;
       update qlist_photo_trial.items set current_operation=oid,version=version+1,epoch=epoch+1 where item_id=op.item_id;
       update qlist_photo_trial.operations set phase='committed',was_committed=true,committed_version=it.version+1 where operation_id=oid;
     end if; -- Durable replay returns prior committed_version; never resurrects it.
   elsif action='cancel' then
     if op.phase in ('reserved','staged') then
       update qlist_photo_trial.operations set phase='cleanup' where operation_id=oid;
     end if;
   else -- cleanup: simulated writer termination and absence are established inside this lock.
     if it.current_operation=oid then raise exception 'cannot_clean_current'; end if;
     if op.phase not in ('cleanup','released') then raise exception 'not_fenced'; end if;
     update qlist_photo_trial.objects set state='simulated-absent',cleanup_verified_at=coalesce(cleanup_verified_at,clock_timestamp()) where operation_id=oid;
     update qlist_photo_trial.operations set phase='released' where operation_id=oid;
   end if;
 elsif action in ('remove','delete_item') then
   if iid is null then raise exception 'invalid_item'; end if;
   if action='delete_item' then
     insert into qlist_photo_trial.items(item_id) values(iid) on conflict do nothing;
   end if;
   select * into it from qlist_photo_trial.items where item_id=iid for update;
   if not found then raise exception 'unknown_item'; end if;
   if action='remove' and (expected is null or it.current_operation is null or expected<>it.version)
   then raise exception 'version_conflict'; end if;
   if not it.deleted then
     update qlist_photo_trial.operations set phase='cleanup'
       where item_id=iid and phase in ('reserved','staged','committed');
     update qlist_photo_trial.items set current_operation=null,epoch=epoch+1,
       deleted=(action='delete_item') where item_id=iid;
   end if;
 elsif action='expire' then
   update qlist_photo_trial.operations set phase='cleanup'
     where phase in ('reserved','staged') and (lease_until<=clock_timestamp() or not is_open);
 end if;
 perform qlist_photo_trial.reconcile(); -- CHECK failure rolls back the entire action.
 select jsonb_build_object('phase','A','simulated_objects',true,
   'budgets',(select jsonb_agg(to_jsonb(t) order by t.scope) from qlist_photo_trial.budgets t),
   'operation',(select to_jsonb(t) from qlist_photo_trial.operations t where t.operation_id=oid),
   'item',(select to_jsonb(t) from qlist_photo_trial.items t where t.item_id=coalesce(iid,(select item_id from qlist_photo_trial.operations where operation_id=oid))),
   'objects',(select coalesce(jsonb_agg(to_jsonb(t) order by t.kind),'[]'::jsonb) from qlist_photo_trial.objects t where t.operation_id=oid)) into result;
 if action='status' then
   bytes_to_charge := octet_length(result::text) + 128; -- conservative allowance for the added accounting field
   update qlist_photo_trial.budgets set read_bytes=read_bytes+bytes_to_charge,read_count=read_count+1 where scope in ('global','PhotoDemo');
   result := result || jsonb_build_object('charged_read_bytes',bytes_to_charge);
 end if;
 return result;
end $$;
revoke all on function public.qlist_photo_trial_rpc(text,jsonb) from public, anon, authenticated;
grant execute on function public.qlist_photo_trial_rpc(text,jsonb) to service_role;
comment on schema qlist_photo_trial is 'Bounded synthetic Phase A only; no real photos or Storage writes.';
notify pgrst, 'reload schema';
commit;
