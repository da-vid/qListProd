-- Non-destructive Phase B stop: no refund, deletion, schema drop, or re-enabling Phase A.
begin;
select 1 from qlist_photo_trial.budgets where scope='global' for update;
select 1 from qlist_photo_trial.budgets where scope='PhotoDemo' for update;
update qlist_photo_trial.budgets set stopped=true,batch_state='blocked';
update qlist_photo_trial.operations set phase='cleanup' where mode='physical' and phase in ('reserved','staged');
revoke execute on function public.qlist_photo_trial_b_rpc(text,jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.qlist_photo_trial_rpc(text,jsonb) from public,anon,authenticated,service_role;
revoke execute on function qlist_photo_trial.reconcile() from public,anon,authenticated,service_role;
revoke all on all tables in schema qlist_photo_trial from service_role;
revoke usage on schema qlist_photo_trial from service_role;
notify pgrst,'reload schema';
commit;
-- Optional stop-deploy-payload.json preserves the same auth gate and returns 410.
-- In-flight Storage requests might still settle; their reservations remain charged.
-- Keep the private bucket, rows and all object evidence for review. No automatic resume.
