-- REVIEW ONLY. Upload stop preserves reads, deletion, history, objects and unknown charges.
-- Run only with separately approved admin access to the dedicated photo project.
begin;
update qlist_photo_beta.ledger
set control=jsonb_set(control,'{enabled}','false'::jsonb)
where singleton;
commit;
-- Do not DROP/TRUNCATE/reset this ledger or the old trial. Do not delete current objects.
-- Existing PUTs may finish: retain their charges and let valid settlement receipts record.
