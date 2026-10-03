-- Read-only; run only against qmpdinzendwpkqhtqskz. Organization inventory is a separate API check.
select encode(sha256(convert_to(pg_get_functiondef('public.qlist_photos_load()'::regprocedure),'UTF8')),'hex') as load_sha256,
 encode(sha256(convert_to(pg_get_functiondef('public.qlist_photos_swap(bigint,jsonb,text,jsonb)'::regprocedure),'UTF8')),'hex') as swap_sha256;
select revision,control,pg_column_size(state) as state_bytes,
 (select count(*) from jsonb_each(state->'ops') where value->>'state'<>'released') as charged_operations,
 (select count(*) from jsonb_each(state->'ops') where value->'writes' @> '["writing"]'::jsonb) as unknown_writers
from qlist_photos.ledger where singleton;
select scope,used_bytes,reserved_bytes,pending_count,photo_count,operation_count,item_count,read_count,read_bytes,expires_at,batch_state,continuation_state from qlist_photo_trial.budgets where scope='global';
select bucket_id,count(*) as object_count,
 sum(case when metadata->>'size' ~ '^[0-9]{1,18}$' then (metadata->>'size')::numeric end) as known_bytes,
 count(*) filter(where metadata->>'size' is null or not(metadata->>'size' ~ '^[0-9]{1,18}$')) as unknown_sizes
from storage.objects group by bucket_id;
select id,public,file_size_limit,allowed_mime_types from storage.buckets;
select schemaname,tablename,policyname,roles,cmd from pg_policies where schemaname='storage';
