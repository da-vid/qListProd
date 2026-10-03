-- Read-only post-application / post-run evidence; no object or metadata mutation.
select scope,cap_bytes,used_bytes,reserved_bytes,photo_count,pending_count,
 operation_count,item_count,read_bytes,read_count,stopped,expires_at,batch_state
from qlist_photo_trial.budgets order by scope;
select mode,phase,count(*) from qlist_photo_trial.operations group by mode,phase order by mode,phase;
select writer_state,count(*),sum(size_bytes) as planned_bytes from qlist_photo_trial.objects
where physical_key is not null group by writer_state order by writer_state;
select operation_id,item_id,phase,actual_bytes,reserved_bytes,was_committed,lease_until
from qlist_photo_trial.operations where mode='physical' order by operation_id;
select operation_id,kind,physical_key,writer_state,verified,physical_deleted_at
from qlist_photo_trial.objects where physical_key is not null order by operation_id,kind;
select role,has_function_privilege(role,'public.qlist_photo_trial_b_rpc(text,jsonb)','execute') as phase_b,
 has_function_privilege(role,'public.qlist_photo_trial_rpc(text,jsonb)','execute') as phase_a
from (values('anon'),('authenticated'),('service_role')) roles(role);
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='qlist_photo_trial' and c.relkind='r' order by c.relname;
select schemaname,tablename,policyname,roles,cmd from pg_policies where schemaname='storage';
select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id='qlist-photo-trial-v1';
select count(*) as remaining_bucket_metadata from storage.objects where bucket_id='qlist-photo-trial-v1';
-- SQL metadata absence alone is not physical deletion evidence. Retain API results too.
