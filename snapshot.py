import json,pathlib,subprocess,hashlib,datetime,sys
r=pathlib.Path('prompt38');r.mkdir(exist_ok=True);repo='MChartier/little-say'
def api(p):return json.loads(subprocess.check_output(['gh','api','repos/'+repo+'/'+p]))
def pages(p):
 out=[];page=1
 while True:
  x=api(p+f'?per_page=100&page={page}');out+=x
  if len(x)<100:return out
  page+=1
pr=api('pulls/38');d={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pr':pr,'master':api('commits/master'),'issue':api('issues/32'),'issueComments':pages('issues/32/comments'),'comments':pages('issues/38/comments'),'reviews':pages('pulls/38/reviews'),'inline':pages('pulls/38/comments'),'commits':pages('pulls/38/commits'),'files':pages('pulls/38/files'),'checks':api('commits/'+pr['head']['sha']+'/check-runs?per_page=100')};d['bodySha256']=hashlib.sha256(pr['body'].encode()).hexdigest();(r/(sys.argv[1] if len(sys.argv)>1 else 'initial.json')).write_bytes((json.dumps(d,indent=2)+'\n').encode())
for k in ['comments','reviews','inline','issueComments']:(r/(k+'.txt')).write_bytes(('\n\n'.join(str(x['id'])+'\n'+(x.get('body') or '') for x in d[k])).encode())
(r/'pr-body.md').write_bytes(pr['body'].encode());(r/'issue-body.md').write_bytes(d['issue']['body'].encode())
q='{repository(owner:"MChartier",name:"little-say"){pullRequest(number:38){headRefOid baseRefOid closingIssuesReferences(first:100){nodes{number}pageInfo{hasNextPage}}reviewThreads(first:100){totalCount nodes{id isResolved isOutdated comments(first:100){nodes{databaseId body path}pageInfo{hasNextPage}}}pageInfo{hasNextPage}}}}}'
native=json.loads(subprocess.check_output(['gh','api','graphql','-f','query='+q]));assert not native.get('errors');(r/'native.json').write_bytes((json.dumps(native,indent=2)+'\n').encode())

print(json.dumps({'head':pr['head']['sha'],'base':pr['base']['sha'],'master':d['master']['sha'],'body':d['bodySha256'],'counts':{k:len(d[k]) for k in ['commits','files','comments','reviews','inline','issueComments']}}))




