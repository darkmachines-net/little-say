// Evidence-only service owner; no product files or external accounts are changed.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const dir=__dirname,root=path.join(dir,'little-say-accounts-master'),runtime=path.join(dir,'account-capture-runtime');
const bin=path.join(runtime,'node_modules/@embedded-postgres/windows-x64/native/bin'),data=path.join(runtime,'launch-capture-data');
const pg=require(path.join(root,'node_modules/pg'));
const run=(exe,args,options={})=>cp.execFileSync(exe,args,{windowsHide:true,encoding:'utf8',...options});
(async()=>{
 if(fs.existsSync(data))throw Error('Capture data already exists; refuse to reuse unknown state');
 run(path.join(bin,'initdb.exe'),['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
 let started=false;
 try{
  run(path.join(bin,'pg_ctl.exe'),['-D',data,'-l',path.join(runtime,'launch-capture-postgres.log'),'-o','-h 127.0.0.1 -p 55424','-w','start'],{stdio:'ignore'});started=true;
  const client=new pg.Client({host:'127.0.0.1',port:55424,user:'postgres',database:'postgres'});await client.connect();const version=(await client.query('SELECT version()')).rows[0].version;await client.query('CREATE DATABASE accounts_capture_test');await client.end();
  const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55424',PGUSER:'postgres',PGDATABASE:'accounts_capture_test',PGPASSWORD:'disposable-test-only',PGSSLMODE:'disable',CAPTURE_POSTGRES_VERSION:version};
  run(process.execPath,['dist/database-cli.js','migrate'],{cwd:path.join(root,'apps/server'),env});
  const child=cp.spawn(process.execPath,[path.join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),'emulators:exec','--only','auth','--project','demo-little-say','node ../capture-accounts-launch-evidence.cjs'],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});if(code!==0)throw Error('Capture child failed: '+code);
 }finally{if(started)run(path.join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);}
})().catch(e=>{console.error(e);process.exitCode=1});
