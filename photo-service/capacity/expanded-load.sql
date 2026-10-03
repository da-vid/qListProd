CREATE OR REPLACE FUNCTION public.qlist_photos_load()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object('revision',l.revision,'control',l.control,'state',l.state,
 'legacyToken',encode(sha256(convert_to(jsonb_build_object('trial',to_jsonb(b),'externalBytes',public.qlist_photos_external_bytes(l.state,b.used_bytes+b.reserved_bytes))::text,'UTF8')),'hex'),
 'storageBudget',jsonb_build_object('bytes',1000000000,'aggregateBytes',1000000000,'externalBytes',public.qlist_photos_external_bytes(l.state,b.used_bytes+b.reserved_bytes)),
 'legacy',jsonb_build_object('bytes',b.used_bytes+b.reserved_bytes,'photos',b.photo_count,'operations',b.operation_count,'items',b.item_count,'reads',b.read_count,'readBytes',b.read_bytes,'pending',b.pending_count))
 from qlist_photos.ledger l cross join qlist_photo_trial.budgets b
 where l.singleton and b.scope='global'
$function$
