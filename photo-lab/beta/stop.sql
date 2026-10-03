-- REVIEW ONLY. Emergency stop preserves history, objects, charges and unknown writers.
-- Run only with separately approved admin access to the dedicated photo project.
begin;
update qlist_photo_beta.ledger
set control=jsonb_set(control,'{enabled}','false'::jsonb)
where singleton;
commit;
-- Do not DROP/TRUNCATE/reset this ledger or the old trial. Do not delete current objects.
-- Existing PUTs may finish: retain their charges and let valid settlement receipts record.
