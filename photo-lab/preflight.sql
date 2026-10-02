-- Read-only project inventory. No image/list contents, secret values, or writes.
-- Run only against qmpdinzendwpkqhtqskz (qlist-photos).
SELECT jsonb_build_object(
  'database_bytes', pg_database_size(current_database()),
  'relations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
      'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'estimated_rows', c.reltuples
    ) ORDER BY n.nspname, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
  ), '[]'::jsonb),
  'public_functions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname, 'security_definer', p.prosecdef
    ) ORDER BY n.nspname, p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'qlist_photo_trial')
  ), '[]'::jsonb),
  'policy_metadata', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'table', tablename, 'name', policyname,
      'roles', roles, 'command', cmd, 'permissive', permissive
    ) ORDER BY schemaname, tablename, policyname)
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage', 'qlist_photo_trial')
  ), '[]'::jsonb)
) AS inventory;

-- Run this separately after the inventory confirms storage.buckets exists.
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at
FROM storage.buckets
ORDER BY created_at;
