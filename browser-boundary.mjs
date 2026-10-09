/** @file Reproduces empty-field translation loss through an isolated real browser and retained current app bundle. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';import {spawn,execFileSync} from 'node:child_process';
import {chromium} from '../../task-10/little-say-translations/node_modules/playwright/index.mjs';
const root=path.resolve('../task-10/little-say-translations'),out=path.resolve('integrated38'),port=7848,origin=`http://127.0.0.1:${port}`,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(out,'owner/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/manifest.json'))),after=manifest.sources.find(x=>x.side==='after');
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef');
assert.equal(hash(fs.readFileSync(path.join(root,'apps/server/dist/index.js'))),after.serverSha256);
for(const f of after.exportFiles)assert.equal(hash(fs.readFileSync(path.join(root,'apps/mobile/dist',f.path))),f.sha256);
await new Promise((resolve,reject)=>{let s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
const env=Object.fromEntries(['SystemRoot','Path','TEMP','TMP','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{HOST:'127.0.0.1',PORT:String(port),WEB_ROOT:path.join(root,'apps/mobile/dist'),AAC_OPENAI_KEY:'',OPENAI_API_KEY:'',DATABASE_URL:'',SPEECH_CACHE_DIR:path.join(out,'browser-speech'),PICTURE_CACHE_DIR:path.join(out,'browser-pictures')});
const server=spawn(process.execPath,[path.join(root,'apps/server/dist/index.js')],{cwd:out,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);let browser;
try{for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'msedge',headless:true});const ctx=await browser.newContext({viewport:{width:1180,height:1000},serviceWorkers:'block'}),page=await ctx.newPage();page.setDefaultTimeout(15000);
 const bundles=[];page.on('response',async r=>{if(r.status()===200&&new URL(r.url()).pathname.startsWith('/_expo/')&&r.url().endsWith('.js')){const bytes=await r.body();bundles.push({path:new URL(r.url()).pathname,sha256:hash(bytes)});}});
 await page.route('**/api/speech',r=>r.fulfill({status:503,json:{error:'QA providers disabled'}}));
 await page.goto(origin+'/app');await page.getByRole('button',{name:'Continue without an account',exact:true}).click();await page.getByRole('heading',{name:'Choose your languages',exact:true}).waitFor();

 const fixture=JSON.parse(fs.readFileSync(path.join(out,'owner/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/fixture.json')));
 const read=()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{let r=indexedDB.open('little-say');r.onsuccess=()=>resolve(r.result);});return await new Promise(resolve=>{let r=db.transaction('state').objectStore('state').get('library');r.onsuccess=()=>{db.close();resolve(r.result);};});});
 const seed=async(data)=>{await page.evaluate(async data=>{const db=await new Promise(resolve=>{let r=indexedDB.open('little-say');r.onsuccess=()=>resolve(r.result);});await new Promise((resolve,reject)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(data,'library');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();},data);await page.reload();await page.getByRole('button',{name:'Edit Our farm words',exact:true}).click();await page.getByRole('button',{name:/^Edit tile /}).first().click();};
 const button=name=>page.getByRole('button',{name,exact:true}).last();
 const field=name=>page.getByRole('textbox',{name,exact:true});
 const results=[];
 for(const legacy of [false,true]){
  const data=structuredClone(fixture);if(!legacy)data.boards[0].tiles[0].translations[0].origin='manual';
  await seed(data);const baseline=(await read()).boards[0];
  await field('Russian words on the tile').fill('');await field('Russian spoken words').fill('');await button('Edit in Spanish').click();await button('Save tile').click();
  await page.getByText('Complete both text fields',{exact:false}).waitFor();assert(await button('Duplicate tile').isDisabled());assert.deepEqual((await read()).boards[0].tiles,baseline.tiles);
  await button('Edit in Russian').click();assert.equal(await field('Russian words on the tile').inputValue(),'');assert.equal(await field('Russian spoken words').inputValue(),'');
  await field('Russian words on the tile').fill('QA correction');await button('Save tile').click();await page.getByText('Complete both text fields',{exact:false}).waitFor();assert(await button('Duplicate tile').isDisabled());
  await button('Cancel').click();await page.reload();assert.deepEqual((await read()).boards[0].tiles,baseline.tiles);
  await page.getByRole('button',{name:'Edit Our farm words',exact:true}).click();await page.getByRole('button',{name:/^Edit tile /}).first().click();
  await field('Russian words on the tile').fill('QA corrected label');await field('Russian spoken words').fill('QA corrected speech');await button('Save tile').click();await page.getByText('Saved on this device',{exact:true}).waitFor();await page.reload();
  const saved=(await read()).boards[0];assert.deepEqual(saved.tiles[1],baseline.tiles[1]);const original=baseline.tiles[0],now=saved.tiles[0];for(const key of ['id','label','speech','language','languageMode','illustration','color'])assert.deepEqual(now[key],original[key]);assert.deepEqual(now.translations.find(t=>t.language==='es-ES'),original.translations.find(t=>t.language==='es-ES'));const corrected=now.translations.find(t=>t.language==='ru-RU');assert.equal(corrected.label,'QA corrected label');assert.equal(corrected.speech,'QA corrected speech');assert.equal(corrected.origin,'manual');
  results.push({scenario:legacy?'legacy empty/partial/cancel/complete/reload':'manual empty/partial/cancel/complete/reload',passed:true,baseline,saved});
 }
 for(const missing of [false,true]){
  const data=structuredClone(fixture);const tile=data.boards[0].tiles[0];if(missing)tile.translations.pop();else tile.translations[1].origin='generated';
  await seed(data);const baseline=(await read()).boards[0];await button('Edit in Spanish').click();await field('Spanish words on the tile').fill('QA Spanish label');await field('Spanish spoken words').fill('QA Spanish speech');await button('Original words').click();await button('Change original language').click();await button('Choose tile language Spanish').click();
  for(const action of ['Save tile','Duplicate tile']){await button(action).click();await page.getByText('Keep the original language and edit its translation instead',{exact:false}).waitFor();assert.deepEqual((await read()).boards[0].tiles,baseline.tiles);}
  await field('Language tag').fill('en-US');await button('Save tile').click();await page.getByText('Saved on this device',{exact:true}).waitFor();await page.reload();const saved=(await read()).boards[0];assert.equal(saved.tiles[0].translations.find(t=>t.language==='es-ES').speech,'QA Spanish speech');assert.deepEqual(saved.tiles[1],baseline.tiles[1]);results.push({scenario:missing?'new draft source collision':'generated-to-manual draft source collision',passed:true,baseline,saved});
 }
 for(const b of bundles){assert.equal(b.sha256,after.exportFiles.find(f=>'/'+f.path===b.path).sha256);}
 fs.writeFileSync(path.join(out,'browser-boundary-result.json'),JSON.stringify({checkedAtUtc:new Date().toISOString(),host:'mchartier_zbook',head:'6db60bbf2f7c43a4d9f88c4b22d5b9c2a4e4edef',runtimeSource:after.sourceSha,browser:browser.version(),serverPid:server.pid,serverSha256:after.serverSha256,fixtureSha256:hash(fs.readFileSync(path.join(out,'owner/19e49364a5814ba30e77e53c96f6f0f72437cdef/merged-dependencies/captures/fixture.json'))),bundles,results},null,2)+'\n');console.log(JSON.stringify(results.map(r=>({scenario:r.scenario,passed:r.passed}))));
}finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));fs.writeFileSync(path.join(out,'browser-server.log'),log);}

