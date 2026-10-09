import pathlib,json,subprocess,hashlib,base64,datetime,difflib
r=pathlib.Path('rebind49');d=json.loads((r/'prepublish.json').read_bytes());old=json.loads(pathlib.Path('final49/prepublish.json').read_bytes());receipt=json.loads(pathlib.Path('final49/trusted-receipt.json').read_bytes());sha=lambda b:hashlib.sha256(b).hexdigest()
def api(p):return json.loads(subprocess.check_output(['gh','api','repos/MChartier/little-say/'+p]))
def save(p,v):(r/p).write_bytes((json.dumps(v,indent=2)+'\n').encode())
assert d['pr']['head']['sha']==receipt['headSha'] and d['master']['sha']==d['pr']['base']['sha']==receipt['baseSha']
assert d['bodySha256']=='e2fb86c0779fd4e3e97ae8dc25cc2830c47553aea6cae7a6697c3d04ce29d91a'
for k in ['commits','files','issue','issueComments','reviews','inline']:assert d[k]==old[k],k
comments={c['id']:c for c in d['comments']};prior=comments[6074115939];assert sha(prior['body'].encode())==receipt['verdictBodySha256'] and prior['updated_at']==receipt['verdictUpdatedAt']
for c in old['comments']:assert comments[c['id']]==c
refusal=comments[6074143560];assert sha(refusal['body'].encode())=='e39b189a2ed6388c9d919876a2893ca0216a023301e11d788df190b4366991b9';assert refusal['updated_at']=='2026-10-09T04:15:58Z';assert refusal['user']['type']=='Bot';assert receipt['headSha'] in comments[6074140197]['body']
save('prior-trusted-receipt.json',receipt);save('quota-refusal.json',refusal)
pub=json.loads(pathlib.Path('final49/published-identities.json').read_bytes());verified=[]
for x in pub['identities']:
 blob=api('git/blobs/'+x['gitBlobSha']);raw=base64.b64decode(blob['content']);assert sha(raw)==x['sha256'] and len(raw)==x['bytes'];verified.append(x)
ownerRecords=[]
for commit,paths in [('92f219f4fd3bcac29a935726cfb2b74ce699663d',['original-manifest.json','original-evidence.zip']),('73a48868d6df246f4f9b8951dfa4dd8542afe16c',['macos-run-37881372074-manifest.json','macos-run-37881372074.zip']),('677eb018af959e30013e84e7f7d33420db63d24e',['pr49-body-e5197e3d.md'])]:
 tree=api('git/trees/'+commit+'?recursive=1');assert not tree['truncated']
 for name in paths:
  x=next(x for x in tree['tree'] if x['path']==name);raw=base64.b64decode(api('git/blobs/'+x['sha'])['content']);assert len(raw)==x['size']
  expected=(old['pr']['body'].encode() if name.startswith('pr49-body') else pathlib.Path('review49' if name.startswith('original') else 'final49',name).read_bytes());assert raw==expected
  ownerRecords.append({'commit':commit,'path':name,'gitBlobSha':x['sha'],'sha256':sha(raw)})
for name,rid,head,conclusion in [('ci',37881717383,receipt['headSha'],'success'),('mac',37881372074,receipt['headParents'][0],'failure')]:
 run=api('actions/runs/'+str(rid));assert run['head_sha']==head and run['conclusion']==conclusion;save(name+'-run.json',run)
 jobs=api('actions/runs/'+str(rid)+'/jobs?per_page=100');save(name+'-jobs.json',jobs)
 if name=='mac':assert len(jobs['jobs'])==8 and sum(j['conclusion']=='skipped' for j in jobs['jobs'])==7
assert d['checks']['total_count']==1 and d['checks']['check_runs'][0]['conclusion']=='success'
git=lambda *a:subprocess.check_output(['git',*a],cwd='little-say-qa').decode().strip()
assert git('rev-parse','HEAD')==receipt['headSha'];assert git('merge-base',receipt['headSha'],receipt['baseSha'])==receipt['mergeBaseSha']
assert git('show','-s','--format=%P',receipt['headSha']).split()==receipt['headParents'];assert git('show','-s','--format=%P',receipt['baseSha']).split()==receipt['targetParents']
diff='\n'.join(difflib.unified_diff(old['pr']['body'].splitlines(),d['pr']['body'].splitlines(),fromfile='old',tofile='new'))+'\n';(r/'body-diff.txt').write_bytes(diff.encode())
v={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'priorReceiptVerified':receipt,'priorEvidenceCommit':pub['commit'],'priorEvidenceArtifactsReverified':verified,'ownerRecordsReverified':ownerRecords,'quotaRefusal':{'id':refusal['id'],'updated_at':refusal['updated_at'],'sha256':sha(refusal['body'].encode()),'login':refusal['user']['login'],'requestId':6074140197,'botCompleted':False},'sourceBaseScopeUnchanged':True,'fullFeedbackRead':True,'ciSuccessUnchanged':True,'macFailureAndSevenSkippedJobsPreserved':True,'bodyDiff':'body-diff.txt','testsRerun':False,'impactAssessment':'Only final description and configured review evidence changed. Prior full code/scope/behavior/evidence assessment and exact artifact identities remain applicable; no expensive suite or new macOS diagnostic required.'};save('verification.json',v);print(json.dumps({'verifiedPriorArtifacts':len(verified),'verifiedOwnerRecords':len(ownerRecords),'refusal':v['quotaRefusal'],'bodyDiff':diff}))
