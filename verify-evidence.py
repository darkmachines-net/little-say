import pathlib,json,hashlib
r=pathlib.Path('recheck35');p=r/'owner/49195f9dd70ce9a9842c460e57348c3d73935cb2';m=json.loads((p/'manifest.json').read_bytes());assert hashlib.sha256((p/'manifest.json').read_bytes()).hexdigest()=='5db775a98b1e6aae4e45eaa1ba08e44241f6f81a0e78d602477a77585c161495'
for f in m['artifacts']:assert hashlib.sha256((p/f['file']).read_bytes()).hexdigest()==f['sha256'],f
checks={}
for f in ['payloads.json','presets.json']:
 b=(p/'before'/f).read_bytes();a=(p/'after'/f).read_bytes();assert a==b;checks[f]={'sha256':hashlib.sha256(a).hexdigest(),'records':list(json.loads(a))}
runtime=json.loads((p/'runtime-report.json').read_bytes());root=pathlib.Path('../task-9/little-say-pr35');bundles=[]
markers=[v.replace('{{visualRules}} ','').replace('{{look}} ','').lstrip()[:75] for n in ['board','pictures','speech'] for v in json.loads(pathlib.Path('little-say-qa/prompts/server',n+'.json').read_bytes()).values()]
shared=['Create a starter soundboard with exactly six cards','Create six farm animal tiles','Create six things a toddler','Create six family tiles']
for platform in runtime['bundles']:
 blobs=[]
 for f in platform['files']:
  b=(root/f['file']).read_bytes();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'];blobs.append(b)
 assert all(not any(m.encode() in b for b in blobs) for m in markers)
 assert all(any(m.encode() in b for b in blobs) for m in shared)
 bundles.append({'platform':platform['platform'],'files':platform['files'],'serverMarkersAbsent':True,'sharedMarkersPresent':True})
old=json.loads(pathlib.Path('reassess35/comment-readback.json').read_bytes());d=json.loads((r/'prepublish.json').read_bytes());c=next(x for x in d['comments'] if x['id']==old['id']);assert c['body']==old['body'] and c['updated_at']==old['updated_at']
report={'manifestEntriesVerified':len(m['artifacts']),'manifestSha256':hashlib.sha256((p/'manifest.json').read_bytes()).hexdigest(),'payloads':checks,'ownerBundleBytesIndependentlyInspected':bundles,'priorReceipt':{'verdictCommentId':c['id'],'verdictBodySha256':hashlib.sha256(c['body'].encode()).hexdigest(),'updated_at':c['updated_at']},'provenance':'Exact commit-addressed captures, tests, alias-pinned harness and logs read. Actual master/final dependency graph is identical; capture uses disclosed shared installation with each checkout core alias, preserving baseline source identities. Runtime/exports bind source and exact bytes.'};(r/'verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'manifestCount':len(m['artifacts']),'payloads':checks,'bundlePlatforms':[x['platform'] for x in bundles],'priorReceipt':report['priorReceipt']}))
