#!/usr/bin/env python3
"""Build a source-complete review package. Never calls a hosted service."""
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'photo-service/review';out.mkdir(parents=True,exist_ok=True)
names=['photo-service/index.ts']+['photo-lab/beta/'+n for n in ['handler.ts','engine.ts','ledger.ts','namespace.ts','sdk.ts']]
names+=['photo-lab/storage-trial/phase-b/codec.js','photo-lab/storage-trial/deno.json','photo-lab/storage-trial/deno.lock','photo-lab/upload-boundary.ts','src/photo/jpeg.ts','src/photo/adapter.ts','src/model.ts']
files=[{'name':name,'content':(root/name).read_text()} for name in names]
assert 'const RUNTIME_ENABLED = true' in files[0]['content']
for f in files:
 assert 'firebaseio.com' not in f['content'] and 'firebaseTextAuthority' not in f['content'], f['name']
pins={'codec.js':'75a280f9a74ad26420d10cb68d8bbea9689e31b2e6bf6d2cd58c45aacdc27ab2','fixtures.js':'bda03b92994e8d381ef70a559bf7bb54423cdd9ca518d904cf3cd0ba04b0d629'}
for name,digest in pins.items():assert hashlib.sha256((root/'photo-lab/storage-trial/phase-b'/name).read_bytes()).hexdigest()==digest
payload={'project_id':'qmpdinzendwpkqhtqskz','name':'qlist-photos','entrypoint_path':'photo-service/index.ts','import_map_path':'photo-lab/storage-trial/deno.json','verify_jwt':False,'files':files}
(out/'deploy-payload.json').write_text(json.dumps(payload,indent=2)+'\n')
(out/'bucket.json').write_text(json.dumps({'id':'qlist-photos-v1','name':'qlist-photos-v1','public':False,'file_size_limit':393216,'allowed_mime_types':['image/jpeg']},indent=2)+'\n')
assets=names+['photo-lab/storage-trial/phase-b/fixtures.js','photo-service/supabase/migrations/20261003054619_qlist_photos_disabled.sql','photo-service/activate.sql','photo-service/stop.sql','photo-service/supabase/config.toml','src/photo/production-entry.ts','src/photo/http-gateway.ts','src/photo/cleanup-journal.ts','src/photo/text-delete.ts','src/photo/normalize.ts','src/photo/ui.ts','src/photo/photo.css','src/main.ts','scripts/build-release.mjs']
assets+=['photo-service/supabase/migrations/20261003193000_qlist_photos_free_capacity.sql','photo-service/capacity/rollback.sql','photo-service/capacity/external-bytes.sql']
manifest={'status':'SOURCE HASHES ONLY; generation performs no deployment','commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()),'project_id':'qmpdinzendwpkqhtqskz','function':'qlist-photos','private_bucket':'qlist-photos-v1','bootstrap_database_enabled_on_migration':False,'bootstrap_maintenance_enabled_on_migration':False,'existing_endpoint_auth_unchanged':True,'capacity_update_status':'PREPARED FOR PARENT REVIEW; NOT APPLIED','public_list_item_namespaces':True,'firebase_reads':False,'product_expiry':None,'new_accounted_bytes':1000000000,'project_accounted_bytes':1000000000,'capacity_migration_preserves_control':True,'capacity_migration':'photo-service/supabase/migrations/20261003193000_qlist_photos_free_capacity.sql','capacity_rollback':'photo-service/capacity/rollback.sql','organization_allowance_is_shared':True,'immutable_dependencies':pins,'sources':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in assets},'payload_sha256':hashlib.sha256((out/'deploy-payload.json').read_bytes()).hexdigest()}
release=root/'release-artifacts/modern/release.json'
if release.exists():
 manifest['modern_release']=json.loads(release.read_text())
 manifest['frontend_source_commit']=manifest['modern_release']['commit']
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'commit':manifest['commit'],'dirty':manifest['dirty'],'payload_sha256':manifest['payload_sha256'],'files':len(files)},indent=2))
