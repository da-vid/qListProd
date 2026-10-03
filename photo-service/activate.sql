-- REVIEW: only after hosted acceptance and approval for the new public endpoint.
-- Does not alter state/revision, the old trial, its expiry, or text data.
begin;
update qlist_photos.ledger
set control='{"enabled":true,"maintenance":true,"lists":[],"allLists":true}'::jsonb
where singleton;
commit;
