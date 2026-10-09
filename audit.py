import pathlib,json,subprocess,hashlib,base64
r=pathlib.Path('current38');c=pathlib.Path('little-say-qa');repo='MChartier/little-say'
def api(p):return json.loads(subprocess.check_output(['gh','api','repos/'+repo+'/'+p]))
def raw(*a):return subprocess.check_output(['git',*a],cwd=c)
def git(*a):return raw(*a).decode().strip()
def sha(b):return hashlib.sha256(b).hexdigest()
def save(n,x):(r/n).write_bytes((json.dumps(x,indent=2)+'\n').encode())
d=json.loads((r/'initial.json').read_bytes());h=d['pr']['head']['sha'];t=d['master']['sha'];b=git('merge-base',h,t)
assert (h,t,b)==('9cada3111541357bc720b9ad66ccfeaa7081171e','b46e9e83ffacb2e3846486fb7a64a57d1203f372','768811832bd0b389ba7e24738fb58800ea145000')
old=json.loads(pathlib.Path('prompt38/scope-verification.json').read_bytes())
def inventory(s):return {'sha':s,'parents':git('show','-s','--format=%P',s).split(),'subject':git('show','-s','--format=%s',s),'perParentPaths':{p:git('diff','--name-status',p,s).splitlines() for p in git('show','-s','--format=%P',s).split()}}
commits=[inventory(s) for s in git('rev-list','--reverse',t+'..'+h).splitlines()];assert commits==old['commits'];assert [x['sha'] for x in commits]==[x['sha'] for x in d['commits']]
for x,y in zip(commits,d['commits']):assert x['parents']==[z['sha'] for z in y['parents']]
paths=git('diff','--name-only',b,h).splitlines();assert set(paths)=={x['filename'] for x in d['files']}
assert d['files']==[{k:v for k,v in x.items() if k!='purpose'} for x in old['files']]
incoming=[inventory(s) for s in git('rev-list','--reverse',b+'..'+t).splitlines()];assert len(incoming)==2
incomingPaths=git('diff','--name-only',b,t).splitlines();assert len(incomingPaths)==14 and not set(paths)&set(incomingPaths)
for s in commits:
 if len(s['parents'])>1:subprocess.check_call(['git','merge-base','--is-ancestor',s['parents'][1],t],cwd=c)
left=json.loads(raw('show',b+':package-lock.json'));right=json.loads(raw('show',t+':package-lock.json'))
for x in [left,right]:
 x.pop('version')
 for p in ['', 'apps/mobile','apps/server']:x['packages'][p].pop('version')
assert left==right
unchanged=[]
for p in ['apps/mobile/src','apps/server/src','packages','prompts','tests/web','apps/mobile/app.config.js','apps/mobile/release-metadata.cjs','.github/workflows/ci.yml','AGENTS.md']:
 assert git('rev-parse',b+':'+p)==git('rev-parse',t+':'+p);unchanged.append({'path':p,'gitObject':git('rev-parse',t+':'+p)})
retained=[]
for n,digest in [(6073011337,'5d23080c9cd2c3e9f8be97bdaee56393ae15d30d4dbd945b9bfe2f4d8cb70ec6'),(6074653139,'0a4b07d6f92cba54e72526dda4355b5d84aa21b9e67efd4f7fbe567599933f56')]:
 x=api('issues/comments/'+str(n));assert sha(x['body'].encode())==digest;save('comment-'+str(n)+'.json',x);retained.append({'commentId':n,'sha256':digest,'updatedAt':x['updated_at']})
q=api('issues/comments/6072408054');save('quota.json',q)
commit='841d692fb92a531f9ac5f3fe27cafc2d59523b27';tr=api('git/trees/'+commit);x=next(x for x in tr['tree'] if x['path']=='verdict.json');z=api('git/blobs/'+x['sha']);data=base64.b64decode(z['content']);assert sha(data)=='2a69a7c58ab0c4a6248f1d47557f28f5d02e28c7b7c077115ece0da0be05b736';assert data==pathlib.Path('prompt38/verdict.json').read_bytes();(r/'prior-verdict.json').write_bytes(data)
cap='19e49364a5814ba30e77e53c96f6f0f72437cdef';tr=api('git/trees/'+cap+'?recursive=1');assert not tr['truncated'];tree={x['path']:x for x in tr['tree']}
access=json.loads((r/'owner/b51b6884ee67afab2fd305fdad90720f517a4094/target-b46-impact/capture-access.json').read_bytes());ids=[]
for a in access['files']:
 x=tree[a['path']];p=pathlib.Path('integrated38/owner')/cap/a['path']
 if p.exists():data=p.read_bytes()
 else:
  data=base64.b64decode(api('git/blobs/'+x['sha'])['content']);p=r/'recovered-originals'/a['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 assert len(data)==x['size']==a['bytes'];assert sha(data)==a['sha256'];assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==x['sha'];assert a.get('gitBlob',x['sha'])==x['sha'];ids.append({**a,'verifiedGitBlobSha':x['sha'],'verifiedRetainedCommit':cap})
save('capture-identities.json',ids)
run=api('actions/runs/37873230024');assert run['head_sha']==h and run['conclusion']=='success';save('ci-run.json',run)
jobs=api('actions/runs/37873230024/jobs?per_page=100');assert jobs['total_count']==len(jobs['jobs']);save('ci-jobs.json',jobs)
q='{repository(owner:"MChartier",name:"little-say"){issue(number:32){projectItems(first:100){nodes{id project{number title} fieldValues(first:100){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2Field{name}}} ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}pageInfo{hasNextPage}}}pageInfo{hasNextPage}}}pullRequest(number:38){projectItems(first:100){nodes{id project{number title}}pageInfo{hasNextPage}}}}}'
p=json.loads(subprocess.check_output(['gh','api','graphql','-f','query='+q]));assert not p.get('errors');save('project.json',p)
related={str(n):api('pulls/'+str(n)) for n in [46,47,49]};assert related['46']['merged'] and related['47']['merged'] and related['49']['state']=='open' and not related['49']['merged'];save('related.json',related)
v=dict(headSha=h,baseSha=t,apiBaseSha=d['pr']['base']['sha'],mergeBaseSha=b,ultimateTargetSha=t,headParents=git('show','-s','--format=%P',h).split(),targetParents=git('show','-s','--format=%P',t).split(),parentRevisions=[],scope={'commits':commits,'files':d['files'],'counts':{'commits':len(commits),'files':len(paths),'additions':sum(x['additions'] for x in d['files']),'deletions':sum(x['deletions'] for x in d['files'])}},incomingCommits=incoming,incomingPaths=incomingPaths,dependencyGraphUnchangedExceptWorkspaceVersions=True,unchangedRuntimeTrees=unchanged,historicalReceipts=retained,captureIdentityCount=len(ids),workingTree=git('status','--porcelain'))
save('verification.json',v);print(json.dumps({'scope':v['scope']['counts'],'incoming':len(incoming),'capturesAndProvenance':len(ids),'project':p}))
