import pathlib,json,hashlib,subprocess,zipfile,datetime
r=pathlib.Path('final49'); root=pathlib.Path('little-say-qa'); d=json.loads((r/'initial.json').read_bytes()); sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=root)
def api(p):return json.loads(subprocess.check_output(['gh','api','repos/MChartier/little-say/'+p]))
h=d['pr']['head']['sha'];b=d['master']['sha'];assert git('rev-parse','HEAD').decode().strip()==h
assert git('merge-base',b,h).decode().strip()==b==d['pr']['base']['sha']
commits=git('rev-list','--reverse',b+'..'+h).decode().split();assert commits==[c['sha'] for c in d['commits']] and len(commits)==3
scope=[]
for c in d['commits']:
 parents=git('show','-s','--format=%P',c['sha']).decode().split();assert parents==[p['sha'] for p in c['parents']]
 scope.append({'sha':c['sha'],'parents':parents,'subject':c['commit']['message'],'paths':git('diff-tree','--no-commit-id','--name-only','-r',c['sha']).decode().splitlines()})
paths=git('diff','--name-only',b,h).decode().splitlines();assert set(paths)=={x['filename'] for x in d['files']};assert len(paths)==10
assert sum(x['additions'] for x in d['files'])==366 and sum(x['deletions'] for x in d['files'])==13
parent=commits[-2];assert set(scope[-1]['paths'])=={'scripts/release/ios-pods-check.mjs','scripts/release/ios-pods-check.test.ts'}
for p in ['apps/mobile/app.config.js','package-lock.json','.github/workflows/cut-release.yml']:assert git('show',h+':'+p)==git('show',parent+':'+p)
m=json.loads((r/'macos-run-37881372074-manifest.json').read_bytes());assert (r/'macos/manifest.json').read_bytes()==(r/'macos-run-37881372074-manifest.json').read_bytes()
for p,digest in m['files'].items():assert sha((r/'macos'/p).read_bytes())==digest,p
a=api('actions/artifacts/11594871300');(r/'actual-artifact.json').write_text(json.dumps(a,indent=2)+'\n');assert a['workflow_run']['id']==37881372074
raw=subprocess.check_output(['gh','api','repos/MChartier/little-say/actions/artifacts/11594871300/zip']);(r/'actual-actions-artifact.zip').write_bytes(raw);assert 'sha256:'+sha(raw)==a['digest']
with zipfile.ZipFile(r/'actual-actions-artifact.zip') as z:
 names=[x for x in z.namelist() if not x.endswith('/')]
 for p in names:assert z.read(p)==(r/'macos/raw-artifact'/p).read_bytes(),p
original=json.loads(pathlib.Path('review49/original-manifest.json').read_bytes())
for p,digest in original['artifacts'].items():assert sha((pathlib.Path('review49/original')/p).read_bytes())==digest,p
for side,source in [('baseline',b),('fix',parent)]:
 q=r/'macos/raw-artifact'/side;record=json.loads((q/'result.json').read_bytes());assert record['source']==source
 for p in ['package-lock.json','app.config.js']:assert (q/p).read_bytes()==git('show',source+':'+('apps/mobile/' if p=='app.config.js' else '')+p)
 assert record['hashes']['diagnostic-script']==sha(git('show',parent+':scripts/release/ios-pods-check.mjs'))
 for p,digest in record['hashes'].items():
  if p!='diagnostic-script':assert sha((q/p).read_bytes())==digest
 fixed=json.loads((r/'macos/raw-artifact/fix/result.json').read_bytes())
assert fixed['commands'][-1]['status']==0 and fixed['error'].startswith('Pod versions differ')
ci=json.loads((r/'ci-run.json').read_bytes());assert ci['head_sha']==h and ci['conclusion']=='success'
merge=api('commits/'+d['pr']['merge_commit_sha']);head=api('commits/'+h);assert merge['commit']['tree']['sha']==head['commit']['tree']['sha'];(r/'ci-tree.json').write_text(json.dumps({'merge':merge,'head':head},indent=2)+'\n')
v={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':h,'base':b,'apiBase':b,'mergeBase':b,'headParents':[parent],'targetParents':git('show','-s','--format=%P',b).decode().split(),'scope':scope,'paths':paths,'counts':{'commits':3,'files':10,'additions':366,'deletions':13},'sourceDigests':{p:sha(git('show',h+':'+p)) for p in paths},'actualActionsArtifact':{'id':a['id'],'digest':a['digest'],'filesComparedExactly':len(names)},'verifiedMacManifestFiles':len(m['files']),'verifiedOriginalArtifacts':len(original['artifacts']),'finalChange':'Only parser and maintained parser regression since actual macOS execution. Product app config, lockfile and workflow unchanged.','ciMergeTreeMatchesHead':True}
(r/'verification.json').write_text(json.dumps(v,indent=2)+'\n');print(json.dumps(v,indent=2))
