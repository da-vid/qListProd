begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
lock table qlist_photo_trial.budgets in share mode;
lock table qlist_photos.ledger in share row exclusive mode;
do $guard$ begin
 if pg_get_functiondef('public.qlist_photos_load()'::regprocedure) is distinct from $expected_load$CREATE OR REPLACE FUNCTION public.qlist_photos_load()
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
$expected_load$ or
 pg_get_functiondef('public.qlist_photos_swap(bigint,jsonb,text,jsonb)'::regprocedure) is distinct from $expected_swap$CREATE OR REPLACE FUNCTION public.qlist_photos_swap(expected_revision bigint, expected_control jsonb, legacy_token text, next_state jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5s'
AS $function$
declare old qlist_photos.ledger%rowtype; b qlist_photo_trial.budgets%rowtype;
 active_count bigint; old_active bigint; pending_count bigint; old_pending bigint; now_ms bigint; external_bytes bigint;
begin
 -- Legacy lock first is compatible with the trial's global-first order.
 select * into strict b from qlist_photo_trial.budgets where scope='global' for share;
 select * into strict old from qlist_photos.ledger where singleton for update;
 external_bytes := public.qlist_photos_external_bytes(old.state,b.used_bytes+b.reserved_bytes);
 if old.revision<>expected_revision or old.control<>expected_control or
 encode(sha256(convert_to(jsonb_build_object('trial',to_jsonb(b),'externalBytes',external_bytes)::text,'UTF8')),'hex')<>legacy_token then return false; end if;
 if next_state is null or jsonb_typeof(next_state)<>'object' or pg_column_size(next_state)>16777216 or
 jsonb_typeof(next_state->'ops') is distinct from 'object' or jsonb_typeof(next_state->'items') is distinct from 'object'
 then raise exception 'invalid_state'; end if;
 if exists(select 1 from jsonb_object_keys(old.state->'ops') k where not (next_state->'ops') ? k) or
 exists(select 1 from jsonb_object_keys(old.state->'items') k where not (next_state->'items') ? k) or
 (next_state->>'requests')::bigint < (old.state->>'requests')::bigint or
 (next_state->>'reads')::bigint < (old.state->>'reads')::bigint or
 (next_state->>'readBytes')::bigint < (old.state->>'readBytes')::bigint
 then raise exception 'history_reset_forbidden'; end if;
 -- Refuse only increasing storage/processing usage at capacity; cleanup and receipts still work.
 now_ms := floor(extract(epoch from statement_timestamp())*1000)::bigint;
 select count(*) filter(where value->>'state'<>'released'),
 count(*) filter(where value->>'state'='pending' and (value->>'lease')::bigint>now_ms)
 into active_count,pending_count from jsonb_each(next_state->'ops');
 select count(*) filter(where value->>'state'<>'released'),
 count(*) filter(where value->>'state'='pending' and (value->>'lease')::bigint>now_ms)
 into old_active,old_pending from jsonb_each(old.state->'ops');
 if (active_count>old_active and (active_count*393216>1000000000 or b.used_bytes+b.reserved_bytes+external_bytes+active_count*393216>1000000000)) or
 (pending_count>old_pending and pending_count>4) or
 (next_state->>'minuteRequests')::bigint>60 or (next_state->>'maintenanceRequests')::bigint>60
 then raise exception 'beta_cap_exceeded'; end if;
 -- Bound new history allocations, not reads or cleanup. No lifetime operation/item/read allowance.
 if pg_column_size(next_state)>8388608 and
 ((select count(*) from jsonb_object_keys(next_state->'ops'))>(select count(*) from jsonb_object_keys(old.state->'ops')) or
  (select count(*) from jsonb_object_keys(next_state->'items'))>(select count(*) from jsonb_object_keys(old.state->'items')))
 then raise exception 'beta_history_storage_full'; end if;
 update qlist_photos.ledger set state=next_state,revision=revision+1 where singleton;
 return true;
end $function$
$expected_swap$ then
  raise exception 'capacity_source_changed_review_required';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.qlist_photos_load()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object('revision',l.revision,'control',l.control,'state',l.state,
 'legacyToken',encode(sha256(convert_to(jsonb_build_object('trial',to_jsonb(b),'externalBytes',public.qlist_photos_external_bytes(l.state,b.used_bytes+b.reserved_bytes))::text,'UTF8')),'hex'),
 'storageBudget',jsonb_build_object('bytes',33554432,'aggregateBytes',67108864,'externalBytes',public.qlist_photos_external_bytes(l.state,b.used_bytes+b.reserved_bytes)),
 'legacy',jsonb_build_object('bytes',b.used_bytes+b.reserved_bytes,'photos',b.photo_count,'operations',b.operation_count,'items',b.item_count,'reads',b.read_count,'readBytes',b.read_bytes,'pending',b.pending_count))
 from qlist_photos.ledger l cross join qlist_photo_trial.budgets b
 where l.singleton and b.scope='global'
$function$
;
CREATE OR REPLACE FUNCTION public.qlist_photos_swap(expected_revision bigint, expected_control jsonb, legacy_token text, next_state jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5s'
AS $function$
declare old qlist_photos.ledger%rowtype; b qlist_photo_trial.budgets%rowtype;
 active_count bigint; old_active bigint; pending_count bigint; old_pending bigint; now_ms bigint; external_bytes bigint;
begin
 -- Legacy lock first is compatible with the trial's global-first order.
 select * into strict b from qlist_photo_trial.budgets where scope='global' for share;
 select * into strict old from qlist_photos.ledger where singleton for update;
 external_bytes := public.qlist_photos_external_bytes(old.state,b.used_bytes+b.reserved_bytes);
 if old.revision<>expected_revision or old.control<>expected_control or
 encode(sha256(convert_to(jsonb_build_object('trial',to_jsonb(b),'externalBytes',external_bytes)::text,'UTF8')),'hex')<>legacy_token then return false; end if;
 if next_state is null or jsonb_typeof(next_state)<>'object' or pg_column_size(next_state)>16777216 or
 jsonb_typeof(next_state->'ops') is distinct from 'object' or jsonb_typeof(next_state->'items') is distinct from 'object'
 then raise exception 'invalid_state'; end if;
 if exists(select 1 from jsonb_object_keys(old.state->'ops') k where not (next_state->'ops') ? k) or
 exists(select 1 from jsonb_object_keys(old.state->'items') k where not (next_state->'items') ? k) or
 (next_state->>'requests')::bigint < (old.state->>'requests')::bigint or
 (next_state->>'reads')::bigint < (old.state->>'reads')::bigint or
 (next_state->>'readBytes')::bigint < (old.state->>'readBytes')::bigint
 then raise exception 'history_reset_forbidden'; end if;
 -- Refuse only increasing storage/processing usage at capacity; cleanup and receipts still work.
 now_ms := floor(extract(epoch from statement_timestamp())*1000)::bigint;
 select count(*) filter(where value->>'state'<>'released'),
 count(*) filter(where value->>'state'='pending' and (value->>'lease')::bigint>now_ms)
 into active_count,pending_count from jsonb_each(next_state->'ops');
 select count(*) filter(where value->>'state'<>'released'),
 count(*) filter(where value->>'state'='pending' and (value->>'lease')::bigint>now_ms)
 into old_active,old_pending from jsonb_each(old.state->'ops');
 if (active_count>old_active and (active_count*393216>33554432 or b.used_bytes+b.reserved_bytes+external_bytes+active_count*393216>67108864)) or
 (pending_count>old_pending and pending_count>4) or
 (next_state->>'minuteRequests')::bigint>60 or (next_state->>'maintenanceRequests')::bigint>60
 then raise exception 'beta_cap_exceeded'; end if;
 -- Bound new history allocations, not reads or cleanup. No lifetime operation/item/read allowance.
 if pg_column_size(next_state)>8388608 and
 ((select count(*) from jsonb_object_keys(next_state->'ops'))>(select count(*) from jsonb_object_keys(old.state->'ops')) or
  (select count(*) from jsonb_object_keys(next_state->'items'))>(select count(*) from jsonb_object_keys(old.state->'items')))
 then raise exception 'beta_history_storage_full'; end if;
 update qlist_photos.ledger set state=next_state,revision=revision+1 where singleton;
 return true;
end $function$
;
commit;
