#!/usr/bin/env python3
"""Build inert, checksum-verified Phase B review and stop payloads; no network."""
import datetime,hashlib,json,pathlib,re,subprocess,zipfile
p=pathlib.Path(__file__).resolve().parent;repo=p.parents[2];trial=p.parent
result=json.loads((p/'local-results.json').read_text());assert result['passed'] and result['local_cluster_stopped'] and len(result['tests'])==31 and result['safeupdate']['service_sessions_preloaded'] and result['runtime']=='v24.21.0'
for name,count in [('boundary-results.tap',7),('jpeg-results.tap',9),('safeupdate-results.tap',5),('cleanup-results.tap',14),('continuation-results.tap',18)]:
 s=(p/name).read_text();assert '# pass '+str(count) in s and '# fail 0' in s
pins={'codec.js':'75a280f9a74ad26420d10cb68d8bbea9689e31b2e6bf6d2cd58c45aacdc27ab2','fixtures.js':'bda03b92994e8d381ef70a559bf7bb54423cdd9ca518d904cf3cd0ba04b0d629'}
for name,h in pins.items():assert hashlib.sha256((p/name).read_bytes()).hexdigest()==h
n=json.loads((trial/'package-lock.json').read_text());d=json.loads((trial/'deno.lock').read_text())
for key,value in d['npm'].items():
 name,version=key.split('_')[0].rsplit('@',1);dep=n['packages']['node_modules/'+name];assert dep['version']==version and dep['integrity']==value['integrity']
reviewed=json.loads((p/'continuation-review.json').read_text())
for name,h in reviewed['runtime_sha256'].items():assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==h
assert hashlib.sha256((p/'continuation-runtime.patch').read_bytes()).hexdigest()==reviewed['runtime_patch_sha256']
entry=(p/'index.ts').read_text();assert 'auth: "secret:default"' in entry and 'data.authMode === "secret"' in entry and '2026-10-04T00:00:00Z' in entry
prefix='photo-lab/storage-trial/phase-b/'
common=['photo-lab/storage-trial/'+name for name in ['deno.json','deno.lock','package.json','package-lock.json']]
active=common+[prefix+name for name in ['index.ts','handler.ts','engine.ts','sdk.ts','codec.js','fixtures.js','LICENSE','LICENSE.codec.md']]+['photo-lab/upload-boundary.ts','src/photo/jpeg.ts']
stop=common+[prefix+'stop.ts']
def payload(files,entrypoint):
 return {'project_id':'qmpdinzendwpkqhtqskz','name':'qlist-photo-storage-trial','entrypoint_path':entrypoint,'import_map_path':'photo-lab/storage-trial/deno.json','verify_jwt':True,'files':[{'name':f,'content':(repo/f).read_text()} for f in files]}
for name,files,entrypoint in [('deploy-payload.json',active,prefix+'index.ts'),('stop-deploy-payload.json',stop,prefix+'stop.ts')]:
 data=json.dumps(payload(files,entrypoint),indent=2)+'\n';assert len(data.encode())<3_000_000;(p/name).write_text(data)
validation={'prepared_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip(),'phase':'B continuation','remote_mutations_in_this_task':False,'hosted_continuation_verified':False,'hosted_cleanup_progress':'Parent cleanup v2 completed; evidence materialized and hash verified','database_tests':31,'http_sdk_tests':18,'safeupdate_source_tests':5,'targeted_jpeg_tests':9,'safeupdate_runtime':result['safeupdate'],'postgres':result['postgres'],'node':'24.21.0','deno_frozen_lock_check':'passed, Deno 2.9.7','dependency_locks_match':True,'codec_sha256':pins['codec.js'],'fixtures_sha256':pins['fixtures.js'],'gateway_verify_jwt':True,'auth':'SDK secret:default','function_deadline':'2026-10-04T00:00:00Z','new_secrets':False,'production_photos_enabled':False,'continuation_rpc_body_md5':reviewed['continuation_rpc_body_md5'],'expected_continuation':reviewed['expected_continuation'],'remaining':reviewed['remaining_acceptance']}
(p/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
files=list(dict.fromkeys(active+stop+[prefix+f for f in ['README.md','rollback.sql','verification.sql','test-local.py','test-local.mjs','boundaries.test.ts','cleanup.test.ts','cleanup-results.tap','reviewed-cleanup.patch','reviewed-cleanup-evidence.json','reviewed-cleanup-manifest.json','independent-cleanup-review.json','safeupdate.test.ts','safeupdate-results.tap','reviewed-safeupdate-fix.sql','safeupdate-fix-evidence.json','prepare-assets.py','build-bundle.py','local-results.json','boundary-results.tap','jpeg-results.tap','validation.json','deploy-payload.json','stop-deploy-payload.json']]+['photo-lab/storage-trial/supabase/migrations/20261002235210_qlist_photo_trial_phase_a.sql','photo-lab/storage-trial/supabase/migrations/20261003002735_qlist_photo_trial_phase_b.sql','photo-lab/storage-trial/supabase/config.toml','photo-lab/storage-trial/rollback.sql','photo-lab/storage-trial/test-postgres.py','photo-lab/storage-trial/test-harness-postgres.mjs','photo-lab/storage-trial/handler.ts','photo-lab/storage-trial/postgres-results.json','photo-lab/upload-boundary.test.ts','photo-lab/small-codec.ts','photo-lab/small-codec.test.ts','photo-lab/package.json','photo-lab/package-lock.json','photo-lab/fixtures/gradient.jpg']))
files += [prefix+f for f in ['HISTORY.md','continuation-runtime.patch','continuation-review.json','continuation-verification.sql','continuation.test.ts','continuation-results.tap','continuation-transfer/qList-phase-b-hosted-cleanup-evidence.json']]
files += ['photo-lab/storage-trial/supabase/migrations/20261003022856_qlist_photo_trial_continuation.sql']
manifest={}
archive=p/'qList-phase-b-review-bundle.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for name in files:
  data=(repo/name).read_bytes();assert not re.search(rb'(sb_secret_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)',data),name
  manifest[name]=hashlib.sha256(data).hexdigest();z.writestr(name,data)
 data=(p/'README.md').read_bytes();manifest['README.md']=hashlib.sha256(data).hexdigest();z.writestr('README.md',data)
 z.writestr('sha256-manifest.json',json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for name,h in manifest.items():assert hashlib.sha256(z.read(name)).hexdigest()==h
 for f in json.loads(z.read(prefix+'deploy-payload.json'))['files']:assert f['content'].encode()==z.read(f['name'])
print(json.dumps({'path':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'verified_entries':len(manifest),'source_commit':validation['source_commit']},indent=2))
