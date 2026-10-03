-- REVIEW ONLY: one bounded continuation of the already cleaned, blocked batch.
-- No history, budget, original ownership/state, expiry, auth or Storage-policy reset.
begin;
select 1 from qlist_photo_trial.budgets where scope='global' for update;
select 1 from qlist_photo_trial.budgets where scope='PhotoDemo' for update;
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='qlist_photo_trial.reconcile()'::regprocedure)
    is distinct from 'd2ae306d98126389774c8cdc7e7ac128'
 or (select md5(prosrc) from pg_proc where oid='public.qlist_photo_trial_b_rpc(text,jsonb)'::regprocedure)
    is distinct from 'a062f7fd5e8b1535c282e5bad0068683' then raise exception 'reviewed_source_mismatch'; end if;
 if (select count(*) from qlist_photo_trial.budgets)<>2 or
    exists(select 1 from qlist_photo_trial.budgets where batch_state<>'blocked' or stopped
    or expires_at<>'2026-10-04T00:00:00Z'::timestamptz or clock_timestamp()>=expires_at
    or used_bytes<>0 or reserved_bytes<>0 or pending_count<>0 or photo_count<>0
    or operation_count<>5 or item_count<>2 or read_count<>4 or read_bytes<>1572864)
    or exists(select 1 from qlist_photo_trial.operations where phase<>'released')
    or exists(select 1 from qlist_photo_trial.items where current_operation is not null)
 then raise exception 'cleaned_hosted_state_required'; end if;
 if exists(select 1 from pg_catalog.pg_policies where schemaname='storage' and tablename in ('objects','buckets'))
 then raise exception 'existing_storage_policies_require_review'; end if;
end $$;
alter table qlist_photo_trial.budgets
 add column continuation_state text not null default 'idle' check(continuation_state in ('idle','running','complete','blocked')),
 add column continuation_owner uuid;
create or replace function public.qlist_photo_trial_b_rpc(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' as $$
declare
 b qlist_photo_trial.budgets%rowtype;
 op qlist_photo_trial.operations%rowtype;
 it qlist_photo_trial.items%rowtype;
 ob qlist_photo_trial.objects%rowtype;
 oid text:=payload->>'operation_id'; iid text:=payload->>'item_id';
 own uuid; ticket uuid; fixture_name text:=payload->>'fixture'; k text:=payload->>'kind';
 expected bigint; fp text; opened boolean; claimed boolean:=false; amount integer; obj jsonb;
begin
 if action is null or action not in ('continuation_claim','continuation_close','reject_unstarted','batch_claim','batch_close','reserve','plan','write_claim','write_ack','write_uncertain','read_claim','verify_ack','commit','cancel','remove','delete_item','expire','cleanup_begin','cleanup_ack','status')
 then raise exception 'invalid_action'; end if;
 if jsonb_typeof(payload) is distinct from 'object' or pg_column_size(payload)>8192 then raise exception 'invalid_payload'; end if;
 if exists(select 1 from jsonb_object_keys(payload) key where key not in
 ('owner','ticket','operation_id','item_id','fixture','expected_version','kind','objects','digest','receipt','result','reason')) then raise exception 'unknown_field'; end if;
 if oid is not null and oid !~ '^phaseb-[a-z0-9-]{1,64}$' then raise exception 'invalid_operation'; end if;
 if iid is not null and iid !~ '^trial-physical-[a-z0-9-]{1,32}$' then raise exception 'invalid_item'; end if;
 if k is not null and k not in ('full','thumb') then raise exception 'invalid_kind'; end if;
 if payload ? 'owner' then own:=(payload->>'owner')::uuid; end if;
 if payload ? 'ticket' then ticket:=(payload->>'ticket')::uuid; end if;
 if payload ? 'expected_version' then
  if (payload->>'expected_version') is null or (payload->>'expected_version') !~ '^[0-9]{1,12}$' then raise exception 'invalid_version'; end if;
  expected:=(payload->>'expected_version')::bigint;
 end if;
 perform 1 from qlist_photo_trial.budgets where scope='global' for update;
 perform 1 from qlist_photo_trial.budgets where scope='PhotoDemo' for update;
 if (select count(*) from qlist_photo_trial.budgets)<>2 then raise exception 'budget_missing'; end if;
 select * into b from qlist_photo_trial.budgets where scope='global';
 select bool_and(not stopped and clock_timestamp()<expires_at) into opened from qlist_photo_trial.budgets;

 if action in ('batch_claim','batch_close') then
  raise exception 'original_batch_closed';
 elsif action='continuation_claim' then
  if not opened then raise exception 'trial_closed'; end if;
  if own is null or own=b.batch_owner or b.continuation_state<>'idle' then raise exception 'continuation_already_claimed'; end if;
  if exists(select 1 from qlist_photo_trial.budgets where batch_state<>'blocked' or continuation_state<>'idle'
    or used_bytes<>0 or reserved_bytes<>0 or photo_count<>0 or pending_count<>0
    or operation_count<>5 or item_count<>2 or read_count<>4 or read_bytes<>1572864
    or cap_bytes<425984 or expires_at<>'2026-10-04T00:00:00Z'::timestamptz)
    or (select count(*) from qlist_photo_trial.operations)<>5
    or (select count(*) from qlist_photo_trial.operations where mode='physical')<>2
    or exists(select 1 from qlist_photo_trial.operations where phase<>'released')
    or exists(select 1 from qlist_photo_trial.items where current_operation is not null)
    or exists(select 1 from qlist_photo_trial.operations where mode='physical' and
      (operation_id not in ('phaseb-batch-base','phaseb-batch-replacement') or item_id<>'trial-physical-replace' or not was_committed
       or fixture<>case operation_id when 'phaseb-batch-base' then 'gradient' else 'portrait' end
       or committed_version<>case operation_id when 'phaseb-batch-base' then 1 else 2 end))
    or (select count(*) from qlist_photo_trial.objects where physical_key is not null)<>4
    or exists(select 1 from qlist_photo_trial.objects where physical_key is not null and
       (writer_state<>'absent' or delete_receipt is null or physical_deleted_at is null))
    then raise exception 'continuation_preflight_failed'; end if;
  update qlist_photo_trial.budgets set continuation_owner=own,continuation_state='running' where scope in ('global','PhotoDemo');
  claimed:=true;
 elsif action='continuation_close' then
  if own is null or own is distinct from b.continuation_owner or b.continuation_state<>'running' then raise exception 'continuation_not_owned'; end if;
  if (payload->>'result') is null or payload->>'result' not in ('complete','blocked') then raise exception 'invalid_result'; end if;
  if payload->>'result'='complete' and (
    (select count(*) from qlist_photo_trial.operations where operation_id in
      ('phaseb-cont-partial','phaseb-cont-deleted','phaseb-cont-noise','phaseb-cont-oversize') and phase='released')<>4
    or exists(select 1 from qlist_photo_trial.operations where phase<>'released')
    or exists(select 1 from qlist_photo_trial.items where current_operation is not null))
    then raise exception 'residual_operations'; end if;
  update qlist_photo_trial.budgets set continuation_state=payload->>'result' where scope in ('global','PhotoDemo');
 elsif action='reserve' then
  if oid is null or oid not in ('phaseb-cont-partial','phaseb-cont-deleted','phaseb-cont-noise','phaseb-cont-oversize')
    or iid is distinct from replace(oid,'phaseb-','trial-physical-') or expected is distinct from 0::bigint
    or fixture_name is distinct from (case oid when 'phaseb-cont-noise' then 'noise' else 'gradient' end)
    then raise exception 'continuation_case_mismatch'; end if;
  if oid is null or iid is null or expected is null or fixture_name is null or fixture_name not in ('gradient','portrait','noise') then raise exception 'invalid_reservation'; end if;
  fp:=encode(sha256(convert_to(jsonb_build_array('PhotoDemo',iid,fixture_name,expected,425984)::text,'UTF8')),'hex');
  select * into op from qlist_photo_trial.operations where operation_id=oid;
  if found then
   if op.request_digest<>fp then raise exception 'idempotency_conflict'; end if;
  else
   if not opened or b.continuation_state<>'running' or own is null or own is distinct from b.continuation_owner then raise exception 'continuation_not_owned'; end if;
   insert into qlist_photo_trial.items(item_id) values(iid) on conflict do nothing;
   select * into it from qlist_photo_trial.items where item_id=iid;
   if it.deleted then raise exception 'item_deleted'; end if;
   if (case when it.current_operation is null then 0 else it.version end)<>expected then raise exception 'version_conflict'; end if;
   insert into qlist_photo_trial.operations(operation_id,item_id,request_digest,fixture,expected_version,captured_epoch,phase,holds_photo,lease_until,mode,writer_owner)
    values(oid,iid,fp,fixture_name,expected,it.epoch,'reserved',it.current_operation is null,least(clock_timestamp()+interval '60 seconds',b.expires_at),'physical',own);
   insert into qlist_photo_trial.objects(operation_id,kind,writer_state) values(oid,'full','unstarted'),(oid,'thumb','unstarted');
  end if;
 elsif action in ('reject_unstarted','plan','write_claim','write_ack','write_uncertain','read_claim','verify_ack','commit','cancel','cleanup_begin','cleanup_ack') then
  select * into op from qlist_photo_trial.operations where operation_id=oid and mode='physical';
  if not found then raise exception 'unknown_operation'; end if;
  select * into it from qlist_photo_trial.items where item_id=op.item_id;
  select * into ob from qlist_photo_trial.objects where operation_id=oid and kind=k;
  if action in ('plan','write_claim','commit') and not (action='commit' and op.was_committed) then
   if not opened or b.continuation_state<>'running' or own is null or own is distinct from op.writer_owner or own is distinct from b.continuation_owner then raise exception 'continuation_not_owned'; end if;
   if oid not in ('phaseb-cont-partial','phaseb-cont-deleted') or action='commit' then raise exception 'continuation_case_mismatch'; end if;
   if clock_timestamp()>=op.lease_until then raise exception 'lease_closed'; end if;
   if it.deleted or it.epoch<>op.captured_epoch then raise exception 'item_fenced'; end if;
   if op.phase not in ('reserved','staged') then raise exception 'operation_fenced'; end if;
  end if;
  if action='reject_unstarted' then
   if own is null or own is distinct from op.writer_owner or own is distinct from b.continuation_owner then raise exception 'writer_mismatch'; end if;
   if oid not in ('phaseb-cont-noise','phaseb-cont-oversize') or
      (payload->>'reason') is distinct from (case oid when 'phaseb-cont-noise' then 'output_too_complex' else 'input_too_large' end)
      then raise exception 'rejection_case_mismatch'; end if;
   if op.phase<>'released' then
    if op.phase not in ('reserved','cleanup') or op.was_committed or op.actual_bytes<>0 or it.current_operation=oid
      or (select count(*) from qlist_photo_trial.objects where operation_id=oid)<>2
      or exists(select 1 from qlist_photo_trial.objects where operation_id=oid and
        (writer_state<>'unstarted' or size_bytes<>0 or write_nonce is not null or digest is not null))
      then raise exception 'never_written_proof_failed'; end if;
    -- DB proof of no ever-granted write; not a fabricated physical deletion receipt.
    update qlist_photo_trial.objects set writer_state='absent',delete_receipt=encode(sha256(convert_to(
      'never-written:'||oid||':'||(payload->>'reason'),'UTF8')),'hex') where operation_id=oid;
    update qlist_photo_trial.operations set phase='released' where operation_id=oid;
   end if;
  elsif action='plan' then
   if exists(select 1 from qlist_photo_trial.objects where operation_id=oid and (writer_state<>'unstarted' or size_bytes<>0)) then raise exception 'immutable_plan'; end if;
   if jsonb_typeof(payload->'objects') is distinct from 'object' or (select count(*) from jsonb_object_keys(payload->'objects'))<>2 then raise exception 'invalid_plan'; end if;
   foreach k in array array['full','thumb'] loop
    obj:=payload->'objects'->k;
    if (obj->>'bytes') is null or (obj->>'bytes') !~ '^[0-9]{1,6}$' or (obj->>'digest') is null or (obj->>'digest') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_plan'; end if;
    amount:=(obj->>'bytes')::integer;
    if amount<=0 then raise exception 'invalid_size'; end if;
    update qlist_photo_trial.objects set size_bytes=amount,digest=obj->>'digest' where operation_id=oid and kind=k;
   end loop;
   update qlist_photo_trial.operations set actual_bytes=(select sum(size_bytes) from qlist_photo_trial.objects where operation_id=oid) where operation_id=oid;
  elsif action='write_claim' then
   if ob.operation_id is null or ticket is null or ob.size_bytes<=0 then raise exception 'unplanned_object'; end if;
   if ob.writer_state='unstarted' then
    update qlist_photo_trial.objects set writer_state='inflight',write_nonce=ticket where operation_id=oid and kind=k;
    claimed:=true;
   end if; -- Never grant the same object a second physical write, including lost claim responses.
  elsif action in ('write_ack','write_uncertain') then
   if own is null or own is distinct from op.writer_owner or ticket is null or ticket is distinct from ob.write_nonce then raise exception 'writer_mismatch'; end if;
   if ob.writer_state not in ('inflight','stored','uncertain') then raise exception 'invalid_writer_state'; end if;
   -- A late acknowledgement cannot clear an uncertainty recorded after a timeout.
   if ob.writer_state='inflight' then update qlist_photo_trial.objects set writer_state=case action when 'write_ack' then 'stored' else 'uncertain' end where operation_id=oid and kind=k; end if;
  elsif action='read_claim' then
   if not opened or ticket is null or ob.operation_id is null or ob.writer_state<>'stored' then raise exception 'read_not_allowed'; end if;
   -- Charge full bucket maximum per GET, including retries/failures; never refund reads.
   update qlist_photo_trial.budgets set read_bytes=read_bytes+393216,read_count=read_count+1 where scope in ('global','PhotoDemo');
   update qlist_photo_trial.objects set read_nonce=ticket where operation_id=oid and kind=k;
   claimed:=true;
  elsif action='verify_ack' then
   if ticket is null or ticket is distinct from ob.read_nonce or ob.writer_state<>'stored' or
      (payload->>'digest') is distinct from ob.digest then raise exception 'verification_mismatch'; end if;
   update qlist_photo_trial.objects set verified=true,read_nonce=null where operation_id=oid and kind=k;
   if op.phase='reserved' and not exists(select 1 from qlist_photo_trial.objects where operation_id=oid and not verified) then update qlist_photo_trial.operations set phase='staged' where operation_id=oid; end if;
  elsif action='commit' then
   if not op.was_committed then
    if op.phase<>'staged' or exists(select 1 from qlist_photo_trial.objects where operation_id=oid and (not verified or writer_state<>'stored')) then raise exception 'not_verified'; end if;
    if (case when it.current_operation is null then 0 else it.version end)<>op.expected_version then raise exception 'version_conflict'; end if;
    update qlist_photo_trial.operations set phase='cleanup' where operation_id=it.current_operation;
    update qlist_photo_trial.items set current_operation=oid,version=version+1,epoch=epoch+1 where item_id=op.item_id;
    update qlist_photo_trial.operations set phase='committed',was_committed=true,committed_version=it.version+1 where operation_id=oid;
   end if;
  elsif action='cancel' then
   update qlist_photo_trial.operations set phase='cleanup' where operation_id=oid and phase in ('reserved','staged');
  else -- Cleanup is allowed only after fencing, with zero unsettled writers.
   if it.current_operation=oid then raise exception 'cannot_clean_current'; end if;
   if op.phase not in ('cleanup','released') then raise exception 'not_fenced'; end if;
   if exists(select 1 from qlist_photo_trial.objects where operation_id=oid and writer_state in ('inflight','uncertain')) then raise exception 'writer_unsettled'; end if;
   if action='cleanup_begin' and op.phase<>'released' then
    if ticket is null then raise exception 'cleanup_ticket_required'; end if;
    update qlist_photo_trial.objects set delete_nonce=coalesce(delete_nonce,ticket) where operation_id=oid;
   elsif action='cleanup_ack' and op.phase<>'released' then
    if ticket is null or (payload->>'receipt') is null or (payload->>'receipt') !~ '^[0-9a-f]{64}$' or
      exists(select 1 from qlist_photo_trial.objects where operation_id=oid and delete_nonce is distinct from ticket) then raise exception 'cleanup_receipt_mismatch'; end if;
    -- Only the trusted server calls this after Storage remove success + HEAD absence.
    -- HTTP callers cannot supply proof fields. DB cannot independently attest S3 state.
    update qlist_photo_trial.objects set writer_state='absent',physical_deleted_at=clock_timestamp(),delete_receipt=payload->>'receipt' where operation_id=oid;
    update qlist_photo_trial.operations set phase='released' where operation_id=oid;
   end if;
  end if;
 elsif action in ('remove','delete_item') then
  if iid is null then raise exception 'invalid_item'; end if;
  if action='delete_item' then insert into qlist_photo_trial.items(item_id) values(iid) on conflict do nothing; end if;
  select * into it from qlist_photo_trial.items where item_id=iid;
  if not found then raise exception 'unknown_item'; end if;
  if action='remove' and (expected is null or it.current_operation is null or expected<>it.version) then raise exception 'version_conflict'; end if;
  if not it.deleted then
   update qlist_photo_trial.operations set phase='cleanup' where item_id=iid and mode='physical' and phase in ('reserved','staged','committed');
   update qlist_photo_trial.items set epoch=epoch+1,current_operation=null,deleted=(action='delete_item') where item_id=iid;
  end if;
 elsif action='expire' then
  update qlist_photo_trial.operations set phase='cleanup' where mode='physical' and phase in ('reserved','staged') and (lease_until<=clock_timestamp() or not opened or b.continuation_state='blocked');
 end if;
 perform qlist_photo_trial.reconcile();
 return jsonb_build_object('phase','B','claimed',claimed,
  'budgets',(select jsonb_agg(to_jsonb(t) order by scope) from qlist_photo_trial.budgets t),
  'operation',(select to_jsonb(t) from qlist_photo_trial.operations t where operation_id=oid and mode='physical'),
  'objects',(select coalesce(jsonb_agg(to_jsonb(t) order by kind),'[]'::jsonb) from qlist_photo_trial.objects t where operation_id=oid and physical_key is not null),
  'physical_operations',(select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'phase',phase) order by operation_id),'[]'::jsonb) from qlist_photo_trial.operations where mode='physical'));
end $$;
revoke all on function public.qlist_photo_trial_b_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.qlist_photo_trial_b_rpc(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
