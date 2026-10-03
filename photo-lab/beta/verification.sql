-- Read-only review after a separately approved disabled installation.
select revision, control,
 (select count(*) from jsonb_object_keys(state->'ops')) as operations,
 (select count(*) from jsonb_object_keys(state->'items')) as items,
 state->'requests' as requests, state->'reads' as reads, state->'readBytes' as read_bytes
from qlist_photo_beta.ledger where singleton;

select * from qlist_photo_trial.budgets where scope='global';
select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='qlist_photo_beta' and c.relkind='r';
select role,has_function_privilege(role,'public.qlist_photo_beta_load()','execute') as can_load,
 has_function_privilege(role,'public.qlist_photo_beta_swap(bigint,jsonb,text,jsonb)','execute') as can_swap
from (values ('anon'),('authenticated'),('service_role')) r(role);
-- Storage objects/bucket metadata must be checked separately through the Storage API.
-- No signed/public URLs, no anon/authenticated Storage policies for the new bucket.

select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename in ('objects','buckets');
