create function public.qlist_photos_external_bytes(known_state jsonb, legacy_bytes bigint) returns bigint
language sql stable security invoker set search_path='' as $function$
 -- Reservations cover the one expected JPEG for every nonreleased operation,
 -- including pending/unknown writers. Count only excess/unaccounted bytes here.
 -- The trial retains its own accounting: charge any physical excess, never refund it.
 -- Unknown/invalid sizes consume the allowance and fail new admissions closed.
 with known as materialized (
  select 'beta-v1/'||key||'/full.jpg' as name from jsonb_each(known_state->'ops')
  where value->>'state'<>'released'
 ), sizes as (
  select o.bucket_id,o.name,
   case when o.metadata->>'size' ~ '^[0-9]{1,18}$'
    then least((o.metadata->>'size')::numeric,1000000000)
    else 1000000000::numeric end as bytes
  from storage.objects o
 ), charges as (
  select bucket_id,
   case when known.name is not null then greatest(sizes.bytes-393216,0)
    else sizes.bytes end as bytes
  from sizes left join known on sizes.bucket_id='qlist-photos-v1' and sizes.name=known.name
 )
 select least(1000000000,
  greatest(coalesce(sum(bytes) filter(where bucket_id='qlist-photo-trial-v1'),0)-legacy_bytes,0)
  + coalesce(sum(bytes) filter(where bucket_id is distinct from 'qlist-photo-trial-v1'),0)
 )::bigint from charges
$function$;
revoke all on function public.qlist_photos_external_bytes(jsonb,bigint) from public,anon,authenticated;
grant execute on function public.qlist_photos_external_bytes(jsonb,bigint) to service_role;
