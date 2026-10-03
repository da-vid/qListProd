#!/usr/bin/env python3
"""Build inert review/deploy artifacts; no network or hosting writes."""
import datetime, hashlib, json, pathlib, re, subprocess, zipfile
p=pathlib.Path(__file__).resolve().parent
n=json.loads((p/'package-lock.json').read_text())
d=json.loads((p/'deno.lock').read_text())
for key,value in d['npm'].items():
 name,version=key.split('_')[0].rsplit('@',1)
 dep=n['packages']['node_modules/'+name]
 assert dep['version']==version and dep['integrity']==value['integrity'],key
sql=list((p/'supabase'/'migrations').glob('*.sql'));assert len(sql)==1
postgres=json.loads((p/'postgres-results.json').read_text())
assert postgres['passed'] and len(postgres['tests'])==15 and postgres['local_cluster_stopped']
assert '# pass 8' in (p/'handler-results.tap').read_text() and '# fail 0' in (p/'handler-results.tap').read_text()
entry=(p/'index.ts').read_text()
assert 'auth: "secret:default"' in entry and 'data.authMode === "secret"' in entry
assert '2026-10-04T00:00:00Z' in entry
files=['index.ts','handler.ts','deno.json','deno.lock','package.json','package-lock.json']
payload={'project_id':'qmpdinzendwpkqhtqskz','name':'qlist-photo-storage-trial','entrypoint_path':'index.ts','import_map_path':'deno.json','verify_jwt':True,'files':[{'name':name,'content':(p/name).read_text()} for name in files]}
(p/'deploy-payload.json').write_text(json.dumps(payload,indent=2)+'\n')
validation={'prepared_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip(),'remote_mutations':False,'phase':'A','objects':'simulated only','postgres_tests':15,'http_tests':8,'harness_cases_in_postgres_suite':5,'postgres_version':postgres['postgres'],'node_version':'24.21.0','deno_typecheck_version':'2.9.7','deno_frozen_lock_check':'passed','node_deno_dependency_integrity_match':True,'new_keys':False,'bucket_created':False,'production_enabled':False,'migration':str(sql[0].relative_to(p)),'function_deadline_utc':'2026-10-04T00:00:00Z','database_deadline':'migration transaction start + 24 hours','gateway_auth':'verify_jwt=true and SDK secret:default','remaining':['parent exact-source review','hosted role/RLS/PostgREST/advisor checks','hosted gateway and authorized invocation','real Storage cleanup proof deferred to Phase B']}
(p/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
files+=['README.md','rollback.sql','postgres-results.json','handler-results.tap','validation.json','deploy-payload.json','test-postgres.py','test-harness-postgres.mjs','handler.test.ts','build-bundle.py','supabase/config.toml',str(sql[0].relative_to(p))]
manifest={}
for name in files:
 data=(p/name).read_bytes(); assert not re.search(rb'(sb_secret_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)',data),name
 manifest[name]=hashlib.sha256(data).hexdigest()
(p/'sha256-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=p/'qList-phase-a-review-bundle.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for name in files+['sha256-manifest.json']:z.write(p/name,name)
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for name,digest in manifest.items():assert hashlib.sha256(z.read(name)).hexdigest()==digest
print(json.dumps({'path':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'verified_entries':len(manifest),'source_commit':validation['source_commit']},indent=2))
