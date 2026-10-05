/** @file Verifies reviewer access to inspected images and records current CI output. */
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const api=p=>JSON.parse(cp.execFileSync('gh',['api',p],{encoding:'utf8',maxBuffer:40e6}));
const names=['before-ready-1280.png','after-ready-1280.png','before-fallback-390.png','after-fallback-390.png','before-home-1280.png','after-home-1280.png','base-privacy.png','after-privacy.png','base-setup-phone.png','after-setup-phone.png'];
const index=JSON.parse(fs.readFileSync('artifacts/qa/evidence-index.json'));
const images=names.map(name=>{const row=index.find(x=>x.file.endsWith('/'+name)&&!x.file.includes('failed-save'));if(!row)throw Error(name);const remote=api('repos/MChartier/little-say/contents/'+row.file+'?ref='+row.ref);if(sha(Buffer.from(remote.content,'base64'))!==row.sha256)throw Error('Remote image mismatch '+name);return {name,url:'https://github.com/MChartier/little-say/blob/'+row.ref+'/'+row.file+'?raw=true',commitSha:row.ref,sha256:row.sha256};});
fs.writeFileSync('artifacts/qa/images-verified.json',JSON.stringify(images,null,2));
const logs=cp.execFileSync('gh',['api','repos/MChartier/little-say/actions/jobs/111953412751/logs'],{maxBuffer:40e6});fs.writeFileSync('artifacts/qa/ci-check.log',logs);console.log(logs.toString().split('\n').filter(x=>/205|Test Files|Tests\s|passed/.test(x)).slice(-20).join('\n'));console.log('Remote verified images: '+images.length);
