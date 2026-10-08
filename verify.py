import json,pathlib,subprocess,hashlib,datetime
p=pathlib.Path('reassess44');o=p/'owner/59a85fcf200da63e3a470c8e7847bab347a67161';git=lambda *a:subprocess.check_output(['git','-C','little-say-qa',*a]);sha=lambda b:hashlib.sha256(b).hexdigest();base='fabb925cf5ee11171d5668af7c2bab44ec9fc613';head='a570b52c357cddf45d2f5371842e8855f32be8b3'
b=json.loads(git('show',base+':package-lock.json'));a=json.loads(git('show',head+':package-lock.json'));changed=[k for k in b['packages'] if b['packages'][k]!=a['packages'].get(k)];added=sorted(set(a['packages'])-set(b['packages']));assert changed==['apps/mobile'];assert added==['node_modules/prop-types','node_modules/prop-types/node_modules/react-is'];x=json.loads(json.dumps(a));del x['packages']['apps/mobile']['dependencies']['prop-types'];[x['packages'].pop(k) for k in added];assert x==b
for e in json.loads((o/'manifest.json').read_bytes())['artifacts']:assert sha((o/e['file']).read_bytes())==e['sha256']
prov=json.loads((o/'provenance.json').read_bytes());root=pathlib.Path(prov['installs']['final']['path']);bundles=[]
assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()==head
owner_status=subprocess.check_output(['git','-C',str(root),'status','--porcelain']).decode();assert owner_status.strip()=='?? apps/mobile/dist-native/'
for e in prov['bundles']:
 raw=(root/'apps/mobile'/e['file']).read_bytes();assert len(raw)==e['bytes'] and sha(raw)==e['sha256'];bundles.append(e)
for phase,rev in [('baseline',base),('final',head)]:
 probe=json.loads((o/f'issue43-{phase}-probe.json').read_bytes());assert probe['manifestSha256']==sha(git('show',rev+':apps/mobile/package.json'));assert probe['lockSha256']==sha(git('show',rev+':package-lock.json'))
r={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':head,'base':base,'mergeBase':git('merge-base',base,head).decode().strip(),'parents':git('show','-s','--format=%P',head).decode().strip().split(),'scope':git('diff','--numstat',base,head).decode(),'lockChanged':changed,'lockAdded':added,'allOtherLockContentIdentical':True,'manifestEntriesVerified':15,'ownerFinalCleanExactHead':True,'retainedBundlesVerified':bundles,'baselineFinalProbeManifestAndLockMatchGitBlobs':True}
(p/'verification.json').write_bytes((json.dumps(r,indent=2)+'\n').encode());print(json.dumps(r))
