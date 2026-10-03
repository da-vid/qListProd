-- REVIEW: only after approval for the new public endpoint, immediately before
-- synthetic hosted acceptance while the existing frontend remains published.
-- Does not alter state/revision, the old trial, its expiry, or text data.
begin;
update qlist_photos.ledger
set control='{"enabled":true,"maintenance":true,"lists":[],"allLists":true}'::jsonb
where singleton;
commit;
