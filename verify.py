import pathlib,json,subprocess,hashlib,datetime
r=pathlib.Path('prompt38');root=pathlib.Path('little-say-qa');d=json.loads((r/'initial.json').read_bytes());head=d['pr']['head']['sha'];base=d['master']['sha'];oh='6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef';ob='18aa7c08615ecf60c8583f0590dcce8ed389f0ea'
sha=lambda x:hashlib.sha256(x).hexdigest()
def raw(*a):return subprocess.check_output(['git',*a],cwd=root)
def git(*a):return raw(*a).decode().strip()
def patchid(b):return subprocess.check_output(['git','patch-id','--stable'],input=b).decode().split()[0]
commits=git('rev-list','--reverse',base+'..'+head).splitlines();assert commits==[c['sha'] for c in d['commits']]
paths=git('diff','--name-only',base,head).splitlines();assert set(paths)=={f['filename'] for f in d['files']}
prior=json.loads(pathlib.Path('integrated38/scope-verification.json').read_bytes()); assert commits[:-1]==[c['sha'] for c in prior['commits']]
def inventory(c):return {'sha':c,'parents':git('show','-s','--format=%P',c).split(),'subject':git('show','-s','--format=%s',c),'perParentPaths':{p:git('diff','--name-status',p,c).splitlines() for p in git('show','-s','--format=%P',c).split()}}
inv=[inventory(c) for c in commits]
for a,b,api in zip(inv,prior['commits'],d['commits']):assert a==b;assert a['parents']==[p['sha'] for p in api['parents']]
assert inv[-1]['parents']==[oh,base]==[p['sha'] for p in d['commits'][-1]['parents']]
assert patchid(raw('diff',ob,base))==patchid(raw('diff',oh,head));assert patchid(raw('diff',ob,oh))==patchid(raw('diff',base,head))
for p in paths:
 if p!='apps/mobile/src/ui/AiConversation.tsx':assert raw('show',oh+':'+p)==raw('show',head+':'+p),p
presets=json.loads(raw('show',head+':prompts/shared/conversation.json'))
for v in presets.values():
 for revision in [ob,oh]:assert ("'"+v+"'").encode() in raw('show',revision+':apps/mobile/src/ui/AiConversation.tsx')
for p in ['package-lock.json','apps/mobile/package.json','AGENTS.md','scripts/release/candidate.ts','.github/workflows/ci.yml']:
 assert raw('show',oh+':'+p)==raw('show',head+':'+p)
s={'head':head,'actualTarget':base,'apiBase':d['pr']['base']['sha'],'mergeBase':git('merge-base',base,head),'headParents':inv[-1]['parents'],'targetParents':git('show','-s','--format=%P',base).split(),'commits':inv,'incomingMaster':[inventory(c) for c in git('rev-list','--reverse',ob+'..'+base).splitlines()],'files':[dict(f,purpose=next(x['purpose'] for x in prior['files'] if x['path']==f['filename'])) for f in d['files']],'totals':{'commits':len(commits),'files':len(paths),'additions':sum(f['additions'] for f in d['files']),'deletions':sum(f['deletions'] for f in d['files'])},'impact':'Prior13 published commits/parents/paths unchanged.14th additive merge exactly matches incoming master patch ID. Net PR patch ID unchanged; all14 other translation files byte-identical. AiConversation only adds shared preset import and replaces3 identical strings. No altered capture state, fixture, layout, correction/audio contract. Native JSON-loading and shared prompt interaction checked on final source; no synthetic integration.'}
assert s['totals']=={'commits':14,'files':15,'additions':675,'deletions':69};assert s['mergeBase']==base
(r/'scope-verification.json').write_bytes((json.dumps(s,indent=2)+'\n').encode())
owner=r/'owner/a42da943d5bfbed0d2faf452e0f7833a65f3bc55/prompt-integration';ids=json.loads((owner/'identities.json').read_bytes());old=pathlib.Path('integrated38/owner/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies');m=json.loads((old/'captures/manifest.json').read_bytes())
assert sha((old/'captures/manifest.json').read_bytes())==ids['captures']['manifestSha256'];assert sha((old/'capture.mjs').read_bytes())==ids['captures']['harnessSha256'];assert sha((old/'captures/fixture.json').read_bytes())==ids['captures']['fixtureSha256']
for c in ids['captures']['images']:assert sha((old/'captures'/c['filename']).read_bytes())==c['sha256']
for e in ids['exports']:
 assert e['sourceSha']==head
 for f in e['files']:
  b=(pathlib.Path(e['localArtifacts'])/f['path']).read_bytes();assert len(b)==f['bytes'] and sha(b)==f['sha256']
receipt=json.loads(pathlib.Path('communication38/trusted-receipt.json').read_bytes());oldcomment=json.loads((owner/'records/prompt-qa.json').read_bytes());assert sha(oldcomment['body'].encode())==receipt['verdictBodySha256'];assert sha((owner/'records/prompt-qa-verdict.json').read_bytes())==receipt['evidenceSha256']
v={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'currentEvidenceManifestSha256':sha((owner/'identities.json').read_bytes()),'captureManifestSha256':ids['captures']['manifestSha256'],'captureHarnessSha256':ids['captures']['harnessSha256'],'captureFixtureSha256':ids['captures']['fixtureSha256'],'captureImages':ids['captures']['images'],'captureAssessment':s['impact'],'priorIndependentPixelVerdict':'f0b4ad600db606ae9f537857520844503b70c925/verdict.json','currentNativeExportsExactFilesVerified':ids['exports'],'priorTrustedReceipt':receipt,'currentExactGitBlobCount':len(json.loads((r/'identities.json').read_bytes()))}
(r/'verification.json').write_bytes((json.dumps(v,indent=2)+'\n').encode());print(json.dumps({'scope':s['totals'],'manifest':v['currentEvidenceManifestSha256'],'nativeExportFilesVerified':sum(len(e['files']) for e in ids['exports'])}))
