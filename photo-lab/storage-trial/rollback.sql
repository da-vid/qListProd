-- Non-destructive stop. Preserve all counters, operations, tombstones and objects.
-- No DROP/TRUNCATE/DELETE, no Storage, no auth/key/billing changes.
begin;
select 1 from qlist_photo_trial.budgets where scope='global' for update;
select 1 from qlist_photo_trial.budgets where scope='PhotoDemo' for update;
update qlist_photo_trial.budgets set stopped=true where scope in ('global','PhotoDemo');
update qlist_photo_trial.operations set phase='cleanup' where phase in ('reserved','staged');
revoke execute on function public.qlist_photo_trial_rpc(text,jsonb) from public,anon,authenticated,service_role;
revoke execute on function qlist_photo_trial.reconcile() from public,anon,authenticated,service_role;
revoke all on all tables in schema qlist_photo_trial from service_role;
revoke usage on schema qlist_photo_trial from service_role;
notify pgrst, 'reload schema';
commit;
-- Parent may disable/delete only the new trial Edge Function via supported tooling.
-- Preserve the v4 benchmark and production. No automatic resume script is provided.
