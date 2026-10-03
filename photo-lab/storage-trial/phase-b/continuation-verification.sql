-- Read-only, after continuation migration. Existing verification.sql also applies.
select scope,cap_bytes,used_bytes,reserved_bytes,photo_count,pending_count,
 operation_count,item_count,read_bytes,read_count,stopped,expires_at,
 batch_state,batch_owner,continuation_state,continuation_owner
from qlist_photo_trial.budgets order by scope;
select operation_id,item_id,fixture,phase,actual_bytes,reserved_bytes,
 was_committed,committed_version,writer_owner,lease_until
from qlist_photo_trial.operations order by operation_id;
select operation_id,kind,physical_key,writer_state,size_bytes,verified,
 write_nonce,delete_receipt,physical_deleted_at
from qlist_photo_trial.objects where physical_key is not null order by operation_id,kind;
select md5(prosrc) as rpc_body_md5,prosecdef as security_definer,proconfig
from pg_proc where oid='public.qlist_photo_trial_b_rpc(text,jsonb)'::regprocedure;
select role,has_function_privilege(role,'public.qlist_photo_trial_b_rpc(text,jsonb)','execute')
from (values('anon'),('authenticated'),('service_role')) roles(role);
select count(*) as remaining_bucket_metadata from storage.objects where bucket_id='qlist-photo-trial-v1';
-- Noise/oversize absent rows have no write_nonce and no physical_deleted_at.
-- Their receipt hashes certify DB never-written state, not Storage deletion.
-- API inventory/receipts/logs remain necessary for physical acceptance.
