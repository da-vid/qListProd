#!/usr/bin/env python3
"""Build inert, checksum-verified Phase B review and stop payloads; no network."""
import datetime,hashlib,json,pathlib,re,subprocess,zipfile
p=pathlib.Path(__file__).resolve().parent;repo=p.parents[2];trial=p.parent
result=json.loads((p/'local-results.json').read_text());assert result['passed'] and result['local_cluster_stopped'] and len(result['tests'])==21
for name,count in [('boundary-results.tap',7),('jpeg-results.tap',9),('safeupdate-results.tap',4),('cleanup-results.tap',14)]:
 s=(p/name).read_text();assert '# pass '+str(count) in s and '# fail 0' in s
pins={'codec.js':'75a280f9a74ad26420d10cb68d8bbea9689e31b2e6bf6d2cd58c45aacdc27ab2','fixtures.js':'bda03b92994e8d381ef70a559bf7bb54423cdd9ca518d904cf3cd0ba04b0d629'}
for name,h in pins.items():assert hashlib.sha256((p/name).read_bytes()).hexdigest()==h
n=json.loads((trial/'package-lock.json').read_text());d=json.loads((trial/'deno.lock').read_text())
for key,value in d['npm'].items():
 name,version=key.split('_')[0].rsplit('@',1);dep=n['packages']['node_modules/'+name];assert dep['version']==version and dep['integrity']==value['integrity']
reviewed=json.loads((p/'reviewed-cleanup-manifest.json').read_text())
for name in ['sdk.ts','engine.ts','handler.ts']:
 assert hashlib.sha256((p/name).read_bytes()).hexdigest()==reviewed['photo-lab/storage-trial/phase-b/'+name]
entry=(p/'index.ts').read_text();assert 'auth: "secret:default"' in entry and 'data.authMode === "secret"' in entry and '2026-10-04T00:00:00Z' in entry
prefix='photo-lab/storage-trial/phase-b/'
common=['photo-lab/storage-trial/'+name for name in ['deno.json','deno.lock','package.json','package-lock.json']]
active=common+[prefix+name for name in ['index.ts','handler.ts','engine.ts','sdk.ts','codec.js','fixtures.js','LICENSE','LICENSE.codec.md']]+['photo-lab/upload-boundary.ts','src/photo/jpeg.ts']
stop=common+[prefix+'stop.ts']
def payload(files,entrypoint):
 return {'project_id':'qmpdinzendwpkqhtqskz','name':'qlist-photo-storage-trial','entrypoint_path':entrypoint,'import_map_path':'photo-lab/storage-trial/deno.json','verify_jwt':True,'files':[{'name':f,'content':(repo/f).read_text()} for f in files]}
for name,files,entrypoint in [('deploy-payload.json',active,prefix+'index.ts'),('stop-deploy-payload.json',stop,prefix+'stop.ts')]:
 data=json.dumps(payload(files,entrypoint),indent=2)+'\n';assert len(data.encode())<3_000_000;(p/name).write_text(data)
validation={'prepared_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip(),'phase':'B','remote_mutations_in_this_task':False,'hosted_storage_fully_verified':False,'hosted_storage_progress':'Parent reports successful gradient/portrait uploads, readback and replacement; cleanup remains blocked awaiting this overlay','database_tests':21,'safeupdate_source_tests':4,'safeupdate_runtime_test':'Not executed: authenticator preload absent from connector/local SQL sessions; parent LOAD attempt denied without bypass','hosted_safeupdate_fix':'Already applied by parent; authenticated run reached uploads, verification and replacement','reviewed_function_md5':{'reconcile':'d2ae306d98126389774c8cdc7e7ac128','phase_b_rpc':'a062f7fd5e8b1535c282e5bad0068683'},'http_sdk_tests':14,'targeted_jpeg_tests':9,'local_storage':'temporary real files with failure injection','postgres':result['postgres'],'node':'24.21.0','deno_frozen_lock_check':'passed, Deno 2.9.7','dependency_locks_match':True,'codec_sha256':pins['codec.js'],'fixtures_sha256':pins['fixtures.js'],'gateway_verify_jwt':True,'auth':'SDK secret:default','function_deadline':'2026-10-04T00:00:00Z','new_secrets':False,'production_photos_enabled':False,'original_uncompleted_batch_expectation':{'admissions':5,'uploads':6,'verification_gets':5,'charged_read_bytes':1966080,'end_used_bytes':0,'end_reserved_bytes':0,'end_objects':0},'cleanup_expectation':{'new_admissions':0,'new_uploads':0,'new_object_reads':0,'batch_stays_blocked':True,'trial_complete':False},'remaining':['parent cleanup-only deployment and invocation','verified deletion and absence of remaining synthetic objects','partial-upload/deletion/noise hosted cases remain unexecuted']}
(p/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
files=list(dict.fromkeys(active+stop+[prefix+f for f in ['README.md','rollback.sql','verification.sql','test-local.py','test-local.mjs','boundaries.test.ts','cleanup.test.ts','cleanup-results.tap','reviewed-cleanup.patch','reviewed-cleanup-evidence.json','reviewed-cleanup-manifest.json','independent-cleanup-review.json','safeupdate.test.ts','safeupdate-results.tap','reviewed-safeupdate-fix.sql','safeupdate-fix-evidence.json','prepare-assets.py','build-bundle.py','local-results.json','boundary-results.tap','jpeg-results.tap','validation.json','deploy-payload.json','stop-deploy-payload.json']]+['photo-lab/storage-trial/supabase/migrations/20261002235210_qlist_photo_trial_phase_a.sql','photo-lab/storage-trial/supabase/migrations/20261003002735_qlist_photo_trial_phase_b.sql','photo-lab/storage-trial/supabase/config.toml','photo-lab/storage-trial/rollback.sql','photo-lab/storage-trial/test-postgres.py','photo-lab/storage-trial/test-harness-postgres.mjs','photo-lab/storage-trial/handler.ts','photo-lab/storage-trial/postgres-results.json','photo-lab/upload-boundary.test.ts','photo-lab/small-codec.ts','photo-lab/small-codec.test.ts','photo-lab/package.json','photo-lab/package-lock.json','photo-lab/fixtures/gradient.jpg']))
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
