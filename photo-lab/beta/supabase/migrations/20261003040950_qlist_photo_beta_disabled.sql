-- REVIEW ONLY: do not apply to hosted storage without separate approval.
-- Independent beta control; reads cumulative trial budgets but never edits/resets them.
begin;
create schema qlist_photo_beta;
revoke all on schema qlist_photo_beta from public, anon, authenticated;
grant usage on schema qlist_photo_beta to service_role;
-- Fail closed if the accepted trial ledger is unavailable. No fresh zero allowance.
do $$ begin
 if exists(select 1 from pg_policies where schemaname='storage' and tablename in ('objects','buckets')) then
  raise exception 'unexpected_storage_policy_requires_review';
 end if;
 if not exists(select 1 from qlist_photo_trial.budgets where scope='global'
 and batch_state='blocked' and continuation_state='complete'
 and used_bytes=0 and reserved_bytes=0 and pending_count=0 and photo_count=0
 and operation_count=9 and item_count=6 and read_count=6 and read_bytes=2359296
 and expires_at='2026-10-04T00:00:00Z'::timestamptz) then
  raise exception 'accepted_legacy_state_requires_review';
 end if;
end $$;
create table qlist_photo_beta.ledger (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 0 check(revision>=0),
 control jsonb not null default '{"enabled":false,"maintenance":false,"lists":[]}',
 state jsonb not null default '{"ops":{},"items":{},"requests":0,"reads":0,"readBytes":0,"minute":0,"minuteRequests":0,"maintenanceMinute":0,"maintenanceRequests":0,"reconciliationCursor":""}',
 check(jsonb_typeof(control->'enabled')='boolean'),
 check(jsonb_typeof(control->'lists')='array' and jsonb_array_length(control->'lists')<=1),
 check(jsonb_typeof(control->'maintenance')='boolean'),
 check(pg_column_size(state)<=16777216)
);
insert into qlist_photo_beta.ledger(singleton) values(true);
alter table qlist_photo_beta.ledger enable row level security;
revoke all on qlist_photo_beta.ledger from public,anon,authenticated,service_role;
grant select on qlist_photo_beta.ledger to service_role;
grant update(state,revision) on qlist_photo_beta.ledger to service_role;

create function public.qlist_photo_beta_load() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('revision',l.revision,'control',l.control,'state',l.state,
 'legacyToken',encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex'),
 'legacy',jsonb_build_object('bytes',b.used_bytes+b.reserved_bytes,'photos',b.photo_count,'operations',b.operation_count,'items',b.item_count,'reads',b.read_count,'readBytes',b.read_bytes,'pending',b.pending_count))
 from qlist_photo_beta.ledger l cross join qlist_photo_trial.budgets b
 where l.singleton and b.scope='global'
$$;
create function public.qlist_photo_beta_swap(expected_revision bigint, expected_control jsonb, legacy_token text, next_state jsonb) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare old qlist_photo_beta.ledger%rowtype; b qlist_photo_trial.budgets%rowtype;
 active_count bigint; old_active bigint; pending_count bigint; old_pending bigint; now_ms bigint;
begin
 -- Legacy lock first is compatible with the trial's global-first order.
 select * into strict b from qlist_photo_trial.budgets where scope='global' for share;
 select * into strict old from qlist_photo_beta.ledger where singleton for update;
 if old.revision<>expected_revision or old.control<>expected_control or
 encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex')<>legacy_token then return false; end if;
 if next_state is null or jsonb_typeof(next_state)<>'object' or pg_column_size(next_state)>16777216 or
 jsonb_typeof(next_state->'ops') is distinct from 'object' or jsonb_typeof(next_state->'items') is distinct from 'object'
 then raise exception 'invalid_state'; end if;
 if exists(select 1 from jsonb_object_keys(old.state->'ops') k where not (next_state->'ops') ? k) or
 exists(select 1 from jsonb_object_keys(old.state->'items') k where not (next_state->'items') ? k) or
 (next_state->>'requests')::bigint < (old.state->>'requests')::bigint or
 (next_state->>'reads')::bigint < (old.state->>'reads')::bigint or
 (next_state->>'readBytes')::bigint < (old.state->>'readBytes')::bigint
 then raise exception 'history_reset_forbidden'; end if;
 -- Refuse only increasing storage/processing usage at capacity; cleanup and receipts still work.
 now_ms := floor(extract(epoch from statement_timestamp())*1000)::bigint;
 select count(*) filter(where value->>'state'<>'released'),
 count(*) filter(where value->>'state'='pending' and (value->>'lease')::bigint>now_ms)
 into active_count,pending_count from jsonb_each(next_state->'ops');
 select count(*) filter(where value->>'state'<>'released'),
 count(*) filter(where value->>'state'='pending' and (value->>'lease')::bigint>now_ms)
 into old_active,old_pending from jsonb_each(old.state->'ops');
 if (active_count>old_active and (active_count*393216>33554432 or b.used_bytes+b.reserved_bytes+active_count*393216>67108864)) or
 (pending_count>old_pending and pending_count>4) or
 (next_state->>'minuteRequests')::bigint>60 or (next_state->>'maintenanceRequests')::bigint>60
 then raise exception 'beta_cap_exceeded'; end if;
 -- Bound new history allocations, not reads or cleanup. No lifetime operation/item/read allowance.
 if pg_column_size(next_state)>8388608 and
 ((select count(*) from jsonb_object_keys(next_state->'ops'))>(select count(*) from jsonb_object_keys(old.state->'ops')) or
  (select count(*) from jsonb_object_keys(next_state->'items'))>(select count(*) from jsonb_object_keys(old.state->'items')))
 then raise exception 'beta_history_storage_full'; end if;
 update qlist_photo_beta.ledger set state=next_state,revision=revision+1 where singleton;
 return true;
end $$;
revoke all on function public.qlist_photo_beta_load() from public,anon,authenticated;
revoke all on function public.qlist_photo_beta_swap(bigint,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.qlist_photo_beta_load(),public.qlist_photo_beta_swap(bigint,jsonb,text,jsonb) to service_role;
commit;
