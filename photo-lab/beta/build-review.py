#!/usr/bin/env python3
"""Generate inert, source-complete disabled deployment input and hashes. Never deploys."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[2];out=root/'photo-lab/beta/review';out.mkdir(exist_ok=True)
names=['photo-lab/beta/'+n for n in ['index.ts','handler.ts','engine.ts','ledger.ts','namespace.ts','sdk.ts']]
names+=['photo-lab/storage-trial/phase-b/codec.js','photo-lab/storage-trial/deno.json','photo-lab/storage-trial/deno.lock','photo-lab/upload-boundary.ts','src/photo/jpeg.ts','src/photo/adapter.ts','src/model.ts']
files=[{'name':name,'content':(root/name).read_text()} for name in names]
assert 'const RUNTIME_ENABLED = false' in files[0]['content']
assert 'const MAINTENANCE_ENABLED = false' in files[0]['content']
pins={'codec.js':'75a280f9a74ad26420d10cb68d8bbea9689e31b2e6bf6d2cd58c45aacdc27ab2','fixtures.js':'bda03b92994e8d381ef70a559bf7bb54423cdd9ca518d904cf3cd0ba04b0d629'}
for name,digest in pins.items(): assert hashlib.sha256((root/'photo-lab/storage-trial/phase-b'/name).read_bytes()).hexdigest()==digest
payload={'project_id':'qmpdinzendwpkqhtqskz','name':'qlist-photo-beta','entrypoint_path':'photo-lab/beta/index.ts','import_map_path':'photo-lab/storage-trial/deno.json','verify_jwt':True,'files':files}
(out/'disabled-deploy-payload.json').write_text(json.dumps(payload,indent=2)+'\n')
assets=names+['photo-lab/storage-trial/phase-b/fixtures.js','photo-lab/beta/supabase/migrations/20261003040950_qlist_photo_beta_disabled.sql','photo-lab/beta/stop.sql','photo-lab/beta/verification.sql','src/photo/beta-entry.ts','src/photo/http-gateway.ts','src/photo/cleanup-journal.ts','src/photo/ui.ts']
manifest={'status':'REVIEW ONLY - disabled; no hosted changes authorized','project_id':'qmpdinzendwpkqhtqskz','new_function':'qlist-photo-beta','new_private_bucket':'qlist-photo-beta-v1','existing_trial_modified':False,'client_enabled':False,'runtime_enabled':False,'database_enabled':False,'anonymous_ingress_enabled':False,'selected_lists':[],'product_expiry':None,'maintenance_enabled':False,'proposed_beta_bytes':33554432,'proposed_project_bytes':67108864,'immutable_dependencies':pins,'requires_external_approval':['new schema and service-only RPC grants','new private bucket with no client policies','new Edge Function','later anonymous ingress on the NEW function only','actual selected list and limited rollout','production client release'],'sources':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in assets},'payload_sha256':hashlib.sha256((out/'disabled-deploy-payload.json').read_bytes()).hexdigest()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items() if k!='sources'},indent=2))
