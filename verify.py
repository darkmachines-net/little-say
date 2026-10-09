"""Verify the communication-only rebind against exact historical and current GitHub records."""
import pathlib,json,hashlib,subprocess,base64,difflib
r=pathlib.Path('communication38');oldr=pathlib.Path('integrated38');load=lambda p:json.loads(pathlib.Path(p).read_bytes());sha=lambda b:hashlib.sha256(b).hexdigest()
def api(p):return json.loads(subprocess.check_output(['gh','api','repos/MChartier/little-say/'+p]))
def blob(commit,path):
 t=api('git/trees/'+commit+'?recursive=1');assert not t['truncated'];x=next(x for x in t['tree'] if x['path']==path);b=api('git/blobs/'+x['sha']);raw=base64.b64decode(b['content']);assert len(raw)==x['size']==b['size'];assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==x['sha'];return raw
d=load(oldr/'communication-final.json');prior=load(oldr/'prepublish.json');v=load(oldr/'verdict.json');receipt=load(oldr/'trusted-receipt.json')
assert d['bodySha256']=='9d785993081bb52f119546e001a9ef62a69b6cb90d2dc28f6d365d77006d1ee8'
assert d['pr']['head']['sha']==v['headSha'] and d['master']['sha']==v['baseSha']==d['pr']['base']['sha']
for k in ['reviews','inline','issueComments','commits','files']:assert d[k]==prior[k],k
assert d['issue']['body']==prior['issue']['body']
added=[c for c in d['comments'] if c['id'] not in {c['id'] for c in prior['comments']}];assert {c['id'] for c in added}=={6072652174,6072690846}
for c in prior['comments']:assert c==next(n for n in d['comments'] if n['id']==c['id'])
qa=next(c for c in added if c['id']==6072652174);assert sha(qa['body'].encode())==receipt['verdictBodySha256'] and qa['updated_at']==receipt['verdictUpdatedAt']
owner=next(c for c in added if c['id']==6072690846);assert sha(owner['body'].encode())=='aaaefe6a02bc514109baf840d8167c0b4c6036bc41ee11599965c68e1cbba38e'
preserved=blob('5a70021a8d4871ccb038aff9396b4b4f82bc7d13','merged-dependencies-publication/pr-body.md');assert preserved==prior['pr']['body'].encode();(r/'prior-body.md').write_bytes(preserved)
oldverdict=blob(receipt['evidenceCommit'],'verdict.json');assert sha(oldverdict)==receipt['evidenceSha256'] and oldverdict==(oldr/'verdict.json').read_bytes()
p=r/'owner/08ba41a38c2be8adb78b6624eec45f44c73808e0/description-correction';assert (p/'description-corrected.md').read_bytes()==d['pr']['body'].encode();assert (p/'description-verdict.json').read_bytes()==oldverdict
ids=load(oldr/'identities.json');verified=[]
for commit in sorted({x['commit'] for x in ids}):
 t=api('git/trees/'+commit+'?recursive=1');assert not t['truncated'];paths={x['path']:x for x in t['tree']}
 for x in [x for x in ids if x['commit']==commit]:assert paths[x['path']]['sha']==x['gitBlobSha'] and paths[x['path']]['size']==x['bytes']
 verified.append({'commit':commit,'exactGitBlobIdentities':len([x for x in ids if x['commit']==commit])})
for path in ['merged-dependencies/captures/manifest.json','merged-dependencies/captures/fixture.json','merged-dependencies/capture.mjs']:
 raw=blob('19e49364a5814ba30e77e53c96f6f0f72437cdef',path);expected=next(x for x in ids if x['path']==path);assert sha(raw)==expected['sha256']
assert d['checks']['total_count']==1 and all(x['status']=='completed' and x['conclusion']=='success' for x in d['checks']['check_runs'])
native=load(oldr/'native.json');n=native['data']['repository']['pullRequest'];assert not n['reviewThreads']['pageInfo']['hasNextPage'] and all(t['isResolved'] and not t['comments']['pageInfo']['hasNextPage'] for t in n['reviewThreads']['nodes'])
assert n['closingIssuesReferences']['nodes']==[{'number':32}]
(r/'prepublish.json').write_bytes((json.dumps(d,indent=2)+'\n').encode());(r/'native.json').write_bytes((oldr/'native.json').read_bytes());(r/'prior-receipt.json').write_bytes((oldr/'trusted-receipt.json').read_bytes())
delta=''.join(difflib.unified_diff(prior['pr']['body'].splitlines(True),d['pr']['body'].splitlines(True),fromfile='prior',tofile='final'));(r/'body-diff.txt').write_bytes(delta.encode())
v['verdict']='ready';v['supersedesVerdictCommentId']=6072652174;v['checkedAtUtc']=d['checkedAtUtc'];v['prBodySha256']=d['bodySha256']
v['findings'][-1]={'id':'C1','status':'resolved','reason':'Final body links the completed integrated technical assessment, removes all pending-independent-reassessment sentences, preserves exact source/BeforeAfter context and native/provider/quota limitations, and does not award readiness. Problem-first narrative and expected/observed testplan remain readable and unchanged.'}
v['gates']['communication']='pass: full final body independently read; concise base-to-final problem/solution, behavior evidence and embedded pairs retained; completed QA status accurate; C1 resolved'
v['limitations']=[x for x in v['limitations'] if not x.startswith('C1')]
v['retainedOriginals']['immediatePriorTrustedReceipt']=receipt
v['communicationRebind']={'checkedAtUtc':d['checkedAtUtc'],'priorAssessment':'https://github.com/MChartier/little-say/blob/'+receipt['evidenceCommit']+'/verdict.json','priorAssessmentSha256':receipt['evidenceSha256'],'ownerCorrectionCommit':'08ba41a38c2be8adb78b6624eec45f44c73808e0','ownerCorrectionIdentities':'identities.json','priorBodySha256':sha(preserved),'currentBodySha256':d['bodySha256'],'scope':'Only two supporting-status paragraphs changed; no source/capture/fixture/bundle/test change. All prior technical/behavior/pixel findings remain applicable. No suites rerun or pixels recaptured.','fullFeedback':'All previously read comments, reviews, inline and issue comments byte-content compared unchanged; both added full comments read. Native threads and issue32 association freshly read. Full prepublication/postpublication gates rerun.','evidenceRecheck':verified,'provenance':'Exact manifest/fixture/harness bytes freshly API-read and hashes verified; all55 retained Git blob identities unchanged, including12images. Prior independent pixel observations reused for unchanged images.','bodyDiff':'body-diff.txt'}
v['feedback']['counts']={k:len(d[k]) for k in ['comments','reviews','inline','issueComments']};v['feedback']['assessment']='Full current content verified and new full comments read. C1 addressed; no new actionable request; exact prior receipt verified.'
v['nextAction']='Coordinator separately preserve this new exact receipt and perform fresh pre/post-readiness source/body/evidence/full-feedback checks. Readiness/draft transition belongs to coordinator. QA complete and idle; no next task started.'
# Existing relative technical record paths resolve in the explicitly pinned prior evidence commit.
v['technicalRecordBaseUrl']='https://github.com/MChartier/little-say/blob/f0b4ad600db606ae9f537857520844503b70c925/'
(r/'verdict.json').write_bytes((json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode());print(json.dumps({'verdict':'ready','body':d['bodySha256'],'priorReceiptVerified':True,'retainedEvidence':verified}));print(delta)
