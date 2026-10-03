#!/usr/bin/env python3
"""Start isolated PostgreSQL with no TCP listener; Node tests use real JPEG files.
No remote DSN or credentials accepted. Usage: python3 test-local.py PG_BIN NODE_BIN
"""
import json,os,pathlib,subprocess,sys,tempfile
p=pathlib.Path(__file__).resolve().parent
bins=pathlib.Path(sys.argv[1]).resolve();node=pathlib.Path(sys.argv[2]).resolve()
env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
env.update({'LC_ALL':'C','LANG':'C'})
root=pathlib.Path(tempfile.mkdtemp(prefix='qlist-physical-'));(root/'socket').mkdir(mode=0o700)
def run(name,*args):
 r=subprocess.run([str(bins/name),*map(str,args)],env=env,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout
started=False
try:
 run('initdb','-D',root/'data','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8','-U','postgres')
 with (root/'data'/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_permissions=0700\nshared_buffers='16MB'\nmax_connections=12\n")
 run('pg_ctl','-D',root/'data','-l',root/'server.log','-o','-k '+str(root/'socket'),'-w','start');started=True
 r=subprocess.run([str(node),str(p/'test-local.mjs'),str(bins/'psql'),str(root/'socket')],env=env,text=True,capture_output=True)
 print(r.stdout);print(r.stderr,file=sys.stderr)
 if r.returncode:raise RuntimeError('Phase B tests failed')
finally:
 if started:run('pg_ctl','-D',root/'data','-m','fast','-w','stop')
 result=p/'local-results.json'
 if result.exists():
  data=json.loads(result.read_text());data['local_cluster_stopped']=started;data['postgres']=run('postgres','--version').strip();result.write_text(json.dumps(data,indent=2)+'\n')
 print('Isolated PostgreSQL stopped; no hosted changes.')
