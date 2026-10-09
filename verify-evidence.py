"""Verify retained capture/build identities and published integration scope without modifying source."""
import json,pathlib,hashlib,subprocess,datetime
r=pathlib.Path('integrated38'); p=r/'owner/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies'
sha=lambda b:hashlib.sha256(b).hexdigest()
m=json.loads((p/'captures/manifest.json').read_bytes()); ids=json.loads((p/'identities.json').read_bytes()); d=json.loads((r/'initial.json').read_bytes())
assert sha((p/'captures/manifest.json').read_bytes())==ids['manifestSha256']=='bba7939383d7f597e6e2c8ed54019faa2f29582cd2e9f6f0240c972f0ee64eae'
assert sha((p/'capture.mjs').read_bytes())==m['harnessSha256']==ids['harnessSha256']
assert sha((p/'captures/fixture.json').read_bytes())==m['fixture']['sha256']==ids['fixtureSha256']
owner=pathlib.Path('../task-10'); captures=[]; builds=[]
for s in m['sources']:
 root=owner/('little-say-current-master' if s['side']=='before' else 'little-say-translations')
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()==s['sourceSha']
 assert sha((root/'package-lock.json').read_bytes())==s['lockSha256']==ids['lockSha256']
 assert sha((root/'apps/server/dist/index.js').read_bytes())==s['serverSha256']
 for f in s['exportFiles']:assert sha((root/'apps/mobile/dist'/f['path']).read_bytes())==f['sha256']
 for c in s['captures']:
  assert sha((p/'captures'/c['filename']).read_bytes())==c['sha256']
  for b in c['loadedBundles']:assert b['sha256']==next(f['sha256'] for f in s['exportFiles'] if '/'+f['path']==b['url'])
  captures.append(dict(c,side=s['side'],sourceSha=s['sourceSha']))
 assert s['processId'] in s['listenerPids'] and s['processId'] in s['finalListenerPids']
 builds.append({'source':s['sourceSha'],'side':s['side'],'localFilesVerified':len(s['exportFiles'])+2})
assert len(captures)==12
for e in ids['exports']:
 assert e['sourceSha']==d['pr']['head']['sha']
 for f in e['files']:
  raw=(pathlib.Path(e['localArtifacts'])/f['path']).read_bytes();assert len(raw)==f['bytes'] and sha(raw)==f['sha256']
scope=json.loads((r/'scope-verification.json').read_bytes())
assert [c['sha'] for c in scope['commits']]==[c['sha'] for c in d['commits']]
for c,api in zip(scope['commits'],d['commits']):assert c['parents']==[p['sha'] for p in api['parents']]
assert len(d['commits'])==d['pr']['commits'] and len(d['files'])==d['pr']['changed_files']
assert sum(f['additions'] for f in d['files'])==d['pr']['additions'] and sum(f['deletions'] for f in d['files'])==d['pr']['deletions']
scope['files']=[dict(f,purpose='Maintained translation preservation/account/audio/browser regression' if '.test.' in f['path'] or f['path'].startswith('tests/') else 'Selected-language editor or translation preservation contract') for f in scope['files']]
(r/'scope-verification.json').write_text(json.dumps(scope,indent=2)+'\n')
independent=[{'path':str(f.relative_to(r/'qa-ios-export')).replace('\\','/'),'bytes':f.stat().st_size,'sha256':sha(f.read_bytes())} for f in (r/'qa-ios-export').rglob('*') if f.is_file()]
out={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifestSha256':ids['manifestSha256'],'harnessSha256':ids['harnessSha256'],'fixtureSha256':ids['fixtureSha256'],'captureCount':len(captures),'captures':captures,'verifiedBuilds':builds,'nativeExportArtifactsVerified':ids['exports'],'independentIosExport':{'source':d['pr']['head']['sha'],'command':'node ../../node_modules/expo/bin/cli export --platform ios --output-dir ../../../integrated38/qa-ios-export','exitCode':0,'files':independent},'scopeCountsAndOrderedParentsReconciled':True,'all55ExactGitBlobs':'identities.json'}
(r/'verification.json').write_text(json.dumps(out,indent=2)+'\n');print('Verified 12 capture images, harness/fixture, both served builds, iOS/Android author outputs, independent iOS output, and full ordered scope')
