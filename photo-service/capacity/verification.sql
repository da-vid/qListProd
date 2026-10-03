-- Read-only post-apply check. Compare controls and history with the latest preflight;
-- legitimate concurrent traffic may advance counters, never restore previous values.
select public.qlist_photos_load()->'storageBudget' as storage_budget;
select encode(sha256(convert_to(pg_get_functiondef('public.qlist_photos_load()'::regprocedure),'UTF8')),'hex') as load_sha256,
 encode(sha256(convert_to(pg_get_functiondef('public.qlist_photos_swap(bigint,jsonb,text,jsonb)'::regprocedure),'UTF8')),'hex') as swap_sha256;
select has_function_privilege('anon','public.qlist_photos_external_bytes(jsonb,bigint)','EXECUTE') as anon_helper,
 has_function_privilege('authenticated','public.qlist_photos_external_bytes(jsonb,bigint)','EXECUTE') as authenticated_helper,
 has_function_privilege('service_role','public.qlist_photos_external_bytes(jsonb,bigint)','EXECUTE') as service_helper;
select revision,control,pg_column_size(state) as state_bytes from qlist_photos.ledger where singleton;
select scope,used_bytes,reserved_bytes,pending_count,photo_count,operation_count,item_count,read_count,read_bytes,expires_at,batch_state,continuation_state from qlist_photo_trial.budgets where scope='global';
