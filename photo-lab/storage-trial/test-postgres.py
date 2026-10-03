#!/usr/bin/env python3
"""Real PostgreSQL integration tests. Creates ONLY an isolated temporary local cluster.
No DSN accepted; no network listener, production connection, credentials, or dependencies.
Usage: python3 test-postgres.py /absolute/path/to/postgresql-17/bin
"""
import concurrent.futures, json, os, pathlib, subprocess, sys, tempfile, time, traceback
ROOT=pathlib.Path(__file__).resolve().parent
BIN=pathlib.Path(sys.argv[1]).resolve()
ENV={k:v for k,v in os.environ.items() if not k.startswith('PG')}
ENV.update({'LC_ALL':'C','LANG':'C'})
REPORT={'postgres':subprocess.check_output([str(BIN/'postgres'),'--version'],text=True).strip(),'tests':[]}
cluster=pathlib.Path(tempfile.mkdtemp(prefix='qlist-phase-a-'))
(cluster/'socket').mkdir(mode=0o700)
def tool(name,*args):
 return subprocess.run([str(BIN/name),*map(str,args)],env=ENV,text=True,capture_output=True,check=True).stdout
started=False
try:
 tool('initdb','-D',cluster/'data','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8','-U','postgres')
 with (cluster/'data'/'postgresql.conf').open('a') as f:
  f.write("\nlisten_addresses = ''\nunix_socket_permissions = 0700\nmax_connections = 12\nshared_buffers = '16MB'\n")
 tool('pg_ctl','-D',cluster/'data','-l',cluster/'server.log','-o',"-k "+str(cluster/'socket'),'-w','start'); started=True
 def sql(q,db='postgres',role=None,ok=True):
  prefix=('set role '+role+';\n') if role else ''
  p=subprocess.run([str(BIN/'psql'),'-X','-qAt','-h',str(cluster/'socket'),'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],input=prefix+q,env=ENV,text=True,capture_output=True)
  if ok and p.returncode: raise AssertionError(p.stderr)
  if not ok:
   assert p.returncode, 'Expected SQL rejection'; return p.stderr
  return p.stdout.strip()
 sql('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;')
 migration=next((ROOT/'supabase'/'migrations').glob('*.sql')).read_text()
 db=''
 def call(action,payload=None,ok=True):
  body=json.dumps(payload or {},separators=(',',':')).replace("'","''")
  result=sql("select public.qlist_photo_trial_rpc('"+action+"','"+body+"'::jsonb);",db,'service_role',ok)
  return json.loads(result) if ok else result
 def reserve(n,item=None,expected=0,fixture='gradient'):
  return call('reserve',{'operation_id':'phasea-'+str(n),'item_id':item or 'trial-'+str(n),'fixture':fixture,'expected_version':expected})
 def op(action,n,ok=True): return call(action,{'operation_id':'phasea-'+str(n)},ok)
 def budgets(): return json.loads(sql("select to_jsonb(b) from qlist_photo_trial.budgets b where scope='global';",db))
 def finish(n): op('stage',n); return op('commit',n)
 def clean(n): op('cancel',n); return op('cleanup',n)
 def parallel(queries):
  import threading
  barrier=threading.Barrier(len(queries))
  def run(q):
   barrier.wait(); return sql(q,db,'service_role')
  with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
   return list(pool.map(run,queries))
 def race_reserve(n,item):
  p=json.dumps({'operation_id':'phasea-'+n,'item_id':item,'fixture':'gradient','expected_version':0})
  # A rejected admission is caught inside a subtransaction; PostgreSQL rolls it back.
  return "do $$ begin perform public.qlist_photo_trial_rpc('reserve','"+p+"'); perform pg_sleep(0.15); exception when check_violation then null; end $$;"
 def test(name,fn):
  global db
  db='trial_'+str(len(REPORT['tests']))
  sql('create database '+db+';'); sql(migration,db)
  start=time.monotonic()
  try: fn(); REPORT['tests'].append({'name':name,'passed':True,'seconds':round(time.monotonic()-start,3)}); print('PASS',name,flush=True)
  except Exception:
   REPORT['tests'].append({'name':name,'passed':False,'error':traceback.format_exc()}); raise
 def security():
  for role in ('anon','authenticated'):
   assert 'permission denied' in sql("select public.qlist_photo_trial_rpc('status');",db,role,False)
   assert 'permission denied' in sql('select * from qlist_photo_trial.operations;',db,role,False)
  assert sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='qlist_photo_trial' and c.relkind='r' and c.relrowsecurity;",db)=='4'
  assert sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='qlist_photo_trial' or p.proname='qlist_photo_trial_rpc') and p.prosecdef;",db)=='0'
  # Accidental SELECT grants still do not expose rows through RLS.
  sql('grant usage on schema qlist_photo_trial to anon; grant select on all tables in schema qlist_photo_trial to anon;',db)
  assert sql('select count(*) from qlist_photo_trial.budgets;',db,'anon')=='0'
  assert 'synthetic_list_only' in call('reserve',{'list_id':'RealList'},False)
  assert 'unknown_field' in call('cleanup',{'objectsAbsent':True},False)
 test('private tables, invoker functions, grants, RLS and synthetic scope',security)
 def exact_capacity():
  sql('update qlist_photo_trial.budgets set cap_bytes=425984;',db)
  parallel([race_reserve('one','trial-one'),race_reserve('two','trial-two')])
  b=budgets(); assert b['reserved_bytes']==425984 and b['operation_count']==1 and b['item_count']==1
  assert sql('select count(*) from qlist_photo_trial.objects;',db)=='2'
 test('two real clients race for exact last-byte capacity; loser fully rolls back',exact_capacity)
 def idem():
  parallel([race_reserve('same','trial-same'),race_reserve('same','trial-same')])
  assert budgets()['operation_count']==1
  before=budgets()
  assert 'idempotency_conflict' in call('reserve',{'operation_id':'phasea-same','item_id':'trial-same','fixture':'portrait','expected_version':0},False)
  assert budgets()==before
  first=finish('same'); again=op('commit','same'); assert first['operation']==again['operation']
 test('simultaneous idempotent admission, conflicting reuse, lost-commit-response replay',idem)
 def pending():
  reserve('one'); reserve('two')
  call('reserve',{'operation_id':'phasea-three','item_id':'trial-three','fixture':'gradient','expected_version':0},False)
  assert budgets()['pending_count']==2 and budgets()['operation_count']==2
  assert sql("select count(*) from qlist_photo_trial.items where item_id='trial-three';",db)=='0'
 test('two-reservation limit rolls back all third-operation metadata',pending)
 def replace_race():
  reserve('base','trial-shared'); finish('base')
  reserve('left','trial-shared',1); reserve('right','trial-shared',1); op('stage','left'); op('stage','right')
  def query(n): return "do $$ begin perform public.qlist_photo_trial_rpc('commit','{\"operation_id\":\"phasea-"+n+"\"}'); perform pg_sleep(0.15); exception when raise_exception then if SQLERRM <> 'version_conflict' then raise; end if; end $$;"
  parallel([query('left'),query('right')])
  assert sql("select count(*) from qlist_photo_trial.operations where phase='committed';",db)=='1'
  b=budgets(); assert b['used_bytes']==42424 and b['reserved_bytes']==425984
  assert 'cannot_clean_current' in call('cleanup',{'operation_id':json.loads(sql("select to_jsonb(i) from qlist_photo_trial.items i;",db))['current_operation']},False)
  op('cleanup','base'); assert budgets()['used_bytes']==21212
  op('cleanup','base'); assert budgets()['used_bytes']==21212
 test('concurrent replacements, old-byte retention and exactly-once cleanup',replace_race)
 def delete_fence():
  reserve('late','trial-deleted'); op('stage_partial','late')
  call('delete_item',{'item_id':'trial-deleted'}); call('delete_item',{'item_id':'trial-deleted'})
  assert 'not_staged' in op('commit','late',False)
  assert 'item_fenced' in op('stage','late',False)
  before=budgets(); assert before['reserved_bytes']==425984
  assert 'item_deleted' in call('reserve',{'operation_id':'phasea-revive','item_id':'trial-deleted','fixture':'gradient','expected_version':0},False)
  op('cleanup','late'); assert budgets()['reserved_bytes']==0
  assert sql("select count(*) from qlist_photo_trial.objects where state='simulated-absent';",db)=='2'
 test('delete during partial staging fences late writers and prevents resurrection',delete_fence)
 def aba():
  reserve('base','trial-aba'); finish('base'); reserve('late','trial-aba',1); op('stage','late')
  call('remove',{'item_id':'trial-aba','expected_version':1}); op('cleanup','base'); op('cleanup','late')
  reserve('new','trial-aba'); finish('new')
  op('commit','late',False)
  replay=op('commit','base'); assert replay['operation']['committed_version']==1 and replay['item']['current_operation']=='phasea-new'
  assert 'version_conflict' in call('remove',{'item_id':'trial-aba','expected_version':1},False)
 test('remove/re-add ABA, stale removal and old commit replay cannot resurrect photos',aba)
 def expired():
  reserve('old'); op('stage_partial','old'); sql("update qlist_photo_trial.operations set lease_until=clock_timestamp()-interval '1 second';",db)
  assert 'lease_closed' in op('stage','old',False)
  call('expire'); assert budgets()['reserved_bytes']==425984 and budgets()['pending_count']==1
  op('cleanup','old'); assert budgets()['reserved_bytes']==0
 test('expiry fences without refund; cleanup releases only after simulated absence',expired)
 def fail_atomic():
  reserve('fail')
  sql("alter table qlist_photo_trial.objects add constraint test_fail check (kind<>'thumb' or state<>'simulated-present');",db)
  op('stage','fail',False)
  assert sql("select count(*) from qlist_photo_trial.objects where state='planned';",db)=='2'
  sql('alter table qlist_photo_trial.objects drop constraint test_fail;',db); op('stage','fail'); op('cancel','fail')
  sql("alter table qlist_photo_trial.objects add constraint test_fail check (state<>'simulated-absent');",db)
  op('cleanup','fail',False); assert budgets()['reserved_bytes']==425984
  sql('alter table qlist_photo_trial.objects drop constraint test_fail;',db); op('cleanup','fail'); assert budgets()['reserved_bytes']==0
 test('injected stage and cleanup SQL failures leave atomic state and retained charges',fail_atomic)
 def photos():
  sql("do $$ declare n int; p jsonb; begin for n in 1..20 loop p=jsonb_build_object('operation_id','phasea-'||n,'item_id','trial-'||n,'fixture','gradient','expected_version',0); perform public.qlist_photo_trial_rpc('reserve',p); perform public.qlist_photo_trial_rpc('stage',p-'item_id'-'fixture'-'expected_version'); perform public.qlist_photo_trial_rpc('commit',p-'item_id'-'fixture'-'expected_version'); end loop; end $$;",db,'service_role')
  assert budgets()['photo_count']==20
  call('reserve',{'operation_id':'phasea-21','item_id':'trial-21','fixture':'gradient','expected_version':0},False)
  assert budgets()['operation_count']==20
 test('20 current-or-reserved photo cap',photos)
 def history():
  sql("do $$ declare n int; p jsonb; begin for n in 1..100 loop p=jsonb_build_object('operation_id','phasea-'||n,'item_id','trial-reused','fixture','portrait','expected_version',0); perform public.qlist_photo_trial_rpc('reserve',p); perform public.qlist_photo_trial_rpc('cancel',p-'item_id'-'fixture'-'expected_version'); perform public.qlist_photo_trial_rpc('cleanup',p-'item_id'-'fixture'-'expected_version'); end loop; end $$;",db,'service_role')
  call('reserve',{'operation_id':'phasea-101','item_id':'trial-reused','fixture':'portrait','expected_version':0},False)
  reserve('1','trial-reused',fixture='portrait'); assert budgets()['operation_count']==100
 test('100 lifetime operations; retries consume no additional operation',history)
 def tombstones():
  sql("do $$ begin for n in 1..100 loop perform public.qlist_photo_trial_rpc('delete_item',jsonb_build_object('item_id','trial-'||n)); end loop; end $$;",db,'service_role')
  call('delete_item',{'item_id':'trial-101'},False); assert budgets()['item_count']==100
 test('100 item/tombstone bound without deleting evidence',tombstones)
 def reads():
  sql('update qlist_photo_trial.budgets set read_count=99;',db); call('status'); call('status',ok=False); assert budgets()['read_count']==100
  sql('update qlist_photo_trial.budgets set read_count=0,read_bytes=5242880;',db)
  call('status',ok=False); assert budgets()['read_bytes']==5242880 and budgets()['read_count']==0
 test('100 verification reads and 5 MiB logical read budget fail closed',reads)
 def stop():
  reserve('pending'); sql("update qlist_photo_trial.budgets set expires_at=clock_timestamp()-interval '1 second';",db)
  assert 'lease_closed' in op('stage','pending',False)
  assert 'trial_closed' in call('reserve',{'operation_id':'phasea-new','item_id':'trial-new','fixture':'gradient','expected_version':0},False)
  before=budgets(); sql((ROOT/'rollback.sql').read_text(),db)
  assert 'permission denied' in sql("select public.qlist_photo_trial_rpc('status');",db,'service_role',False)
  after=budgets(); assert after['stopped'] and after['reserved_bytes']==before['reserved_bytes']
  assert sql('select count(*) from qlist_photo_trial.operations;',db)=='1'
 test('24-hour deadline and non-destructive rollback preserve charges/evidence',stop)
 def hosted():
  p=subprocess.run([os.environ.get('QLIST_TRIAL_NODE','node'),str(ROOT/'test-harness-postgres.mjs'),str(BIN/'psql'),str(cluster/'socket'),db],env=ENV,text=True,capture_output=True)
  assert p.returncode==0,p.stderr
  assert p.stdout.count('PASS harness case')==5
 test('five hosted harness scenarios through actual SQL clients',hosted)
 REPORT['passed']=all(t['passed'] for t in REPORT['tests'])
finally:
 if started: tool('pg_ctl','-D',cluster/'data','-m','fast','-w','stop')
 REPORT['local_cluster_stopped']=started
 (ROOT/'postgres-results.json').write_text(json.dumps(REPORT,indent=2)+'\n')
 print('RESULT',len(REPORT['tests']),'tests; local cluster stopped' if started else 'cluster not started',flush=True)
