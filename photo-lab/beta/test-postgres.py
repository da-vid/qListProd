#!/usr/bin/env python3
"""Isolated, temporary Unix-socket PostgreSQL; no DSN or credential input."""
import os,pathlib,subprocess,sys,tempfile
p=pathlib.Path(__file__).resolve().parent
bins=pathlib.Path(sys.argv[1]).resolve();node=pathlib.Path(sys.argv[2]).resolve()
safe=pathlib.Path('/tmp/qlist-continuation-safeupdate/safeupdate.dylib').resolve()
env={k:v for k,v in os.environ.items() if not k.startswith('PG')};env.update(LC_ALL='C',LANG='C')
root=pathlib.Path(tempfile.mkdtemp(prefix='qlist-beta-pg-'));(root/'socket').mkdir(mode=0o700)
def run(name,*args):
 r=subprocess.run([str(bins/name),*map(str,args)],env=env,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout
started=False
try:
 run('initdb','-D',root/'data','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8','-U','postgres')
 with (root/'data'/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_permissions=0700\nshared_buffers='16MB'\nmax_connections=12\n")
 run('pg_ctl','-D',root/'data','-l',root/'server.log','-o','-k '+str(root/'socket'),'-w','start');started=True
 result=subprocess.run([str(node),str(p/'test-postgres.mjs'),str(bins/'psql'),str(root/'socket'),str(safe) if safe.exists() else ''],env=env,text=True)
 if result.returncode:raise RuntimeError('Beta PostgreSQL tests failed')
finally:
 if started:run('pg_ctl','-D',root/'data','-m','fast','-w','stop')
 print('Temporary beta PostgreSQL stopped; no hosted changes.')
