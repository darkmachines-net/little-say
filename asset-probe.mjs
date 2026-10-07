/** @file Independent read-only-source boundary QA against isolated exact production build bytes. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import vm from 'node:vm';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {chromium} from './runtime/after/node_modules/playwright/index.mjs';
import ts from './runtime/after/node_modules/typescript/lib/typescript.js';
const output=path.resolve('asset-probe');fs.mkdirSync(output,{recursive:true});const result={time:new Date().toISOString(),source:'b21d3ba7370c08468b868385ce9df3d875eee799',checks:[],bundles:[],limitations:['Browser checks only; no OS font scaling, TalkBack, VoiceOver or physical rotation']};
const record=(name,detail)=>{result.checks.push({name,detail});console.log(name,JSON.stringify(detail));};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const code=ts.transpile(fs.readFileSync('qa-worktree/packages/core/src/boardLayout.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});const {gridLayout}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let cases=0;for(const [w,h] of [[788,1088],[1148,728],[358,752],[812,298],[288,228],[44,44],[99,120],[300,64]])for(let n=1;n<=24;n++){const l=gridLayout(n,w,h);if(l.fits){assert.equal(l.rects.length,n);assert(Math.max(...l.rowCounts)-Math.min(...l.rowCounts)<=1);for(const [i,r] of l.rects.entries()){assert(r.width>=44&&r.height>=44);assert(r.x>=-1e-6&&r.y>=-1e-6&&r.x+r.width<=w+1e-6&&r.y+r.height<=h+1e-6);for(const s of l.rects.slice(i+1))assert(r.x+r.width<=s.x+1e-6||s.x+s.width<=r.x+1e-6||r.y+r.height<=s.y+1e-6||s.y+s.height<=r.y+1e-6);}assert.deepEqual(l,gridLayout(n,w,h));}cases++;}record('numeric geometry boundary probe',{cases});
const harness=fs.readFileSync('retained-evidence/capture-grid.mjs','utf8');const fixture=vm.runInNewContext(`const clock='2026-10-07T00:00:00.000Z';${harness.slice(harness.indexOf('const colors ='),harness.indexOf('async function checkFree'))};fixture`);
const root=path.resolve('runtime/after'),port=7464,origin=`http://127.0.0.1:${port}`;
const log=fs.openSync(`${output}/server.log`,'w');const server=spawn(process.execPath,[`${root}/apps/server/dist/index.mjs`],{cwd:`${root}/apps/server`,windowsHide:true,stdio:['ignore',log,log],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,HOST:'127.0.0.1',PORT:String(port),WEB_ROOT:`${root}/web`,ALLOWED_ORIGINS:origin,AAC_OPENAI_KEY:'',OPENAI_API_KEY:'',DATABASE_URL:'',AAC_IMAGE_GENERATION:'false',PICTURE_CACHE_DIR:`${root}/cache/pictures`,SPEECH_CACHE_DIR:`${root}/cache/speech`}});fs.closeSync(log);
let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(server.exitCode!==null)throw Error('server exited');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'msedge',headless:true});result.browser=browser.version();
 const context=await browser.newContext({viewport:{width:820,height:1180},serviceWorkers:'block',deviceScaleFactor:1,colorScheme:'light'});const page=await context.newPage();
 await page.addInitScript(()=>{window.__spoken=[];window.__utterances=[];window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{voiceURI:'qa',name:'English',lang:'en-US',localService:true,default:true}],speak:u=>{window.__spoken.push(u.text);window.__utterances.push(u);},cancel:()=>{window.__utterances=[];},addEventListener(){},removeEventListener(){}}});Element.prototype.requestFullscreen=async()=>{};});
 const bundlePromises=[];page.on('response',r=>{const u=new URL(r.url());if(r.status()===200&&u.origin===origin&&u.pathname.endsWith('.js')&&u.pathname.startsWith('/_expo/'))bundlePromises.push((async()=>{const bytes=await r.body();assert.equal(hash(bytes),hash(fs.readFileSync(`${root}/web${u.pathname}`)));result.bundles.push({path:u.pathname,sha256:hash(bytes)});})());});
 const settle=async()=>{await page.evaluate(()=>document.fonts.ready);let old='',stable=0;for(let i=0;i<50&&stable<4;i++){const s=await page.locator('[data-testid="play-board"], [data-testid="editor-preview"]').evaluateAll(roots=>JSON.stringify(roots.flatMap(r=>[...r.querySelectorAll('*')].map(e=>{const b=e.getBoundingClientRect();return [b.x,b.y,b.width,b.height,getComputedStyle(e).fontSize];}))));stable=s===old?stable+1:0;old=s;await page.waitForTimeout(80);}assert(stable>=4);};
 let firstOpen=true;
 async function open(n,mode='play',custom){await page.goto(origin+'/app');if(firstOpen){await page.getByRole('heading',{name:'Choose your languages',exact:true}).waitFor();firstOpen=false;}await page.waitForFunction(()=>indexedDB.databases().then(d=>d.some(x=>x.name==='little-say')));const data=custom||fixture(n,mode);await page.evaluate(async data=>{const db=await new Promise(r=>{const x=indexedDB.open('little-say');x.onsuccess=()=>r(x.result);});await new Promise((r,j)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(data,'library');t.oncomplete=r;t.onerror=j;});db.close();},data);await page.reload();if(mode==='edit')await page.getByRole('button',{name:'Edit My everyday words',exact:true}).click();await settle();return data;}
 async function geometry(){return page.getByTestId('touch-surface').getByRole('button').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),x:r.x,y:r.y,width:r.width,height:r.height};}));}

 await open(24);
 const data=fixture(24,'play');
 data.boards[0].tiles[23].illustration={kind:'photo',assetId:'qa-photo',zoom:1.6,x:-0.5,y:0.25};
 data.boards[0].tiles[22].label='Помоги мне найти любимые вещи';
 data.boards[0].tiles[22].language='ru-RU';
 await page.evaluate(async data=>{
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const c=canvas.getContext('2d');
   c.fillStyle='#B8DFF4';c.fillRect(0,0,1200,800);c.fillStyle='#B4DBBD';c.fillRect(0,580,1200,220);c.fillStyle='#EFCE6F';c.beginPath();c.arc(900,250,180,0,Math.PI*2);c.fill();c.fillStyle='#453331';for(const x of [850,950]){c.beginPath();c.arc(x,230,15,0,Math.PI*2);c.fill();}
   const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
   const db=await new Promise(r=>{const x=indexedDB.open('little-say');x.onsuccess=()=>r(x.result);});
   await new Promise((r,j)=>{const t=db.transaction(['state','photos'],'readwrite');t.objectStore('state').put(data,'library');t.objectStore('photos').put(blob,'qa-photo');t.oncomplete=r;t.onerror=j;});db.close();
 },data);
 await page.reload();await page.getByTestId('photo-image').waitFor();await settle();
 let expected;
 for(const size of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]){
   await page.setViewportSize(size);await settle();
   const f=await page.getByTestId('photo-frame').boundingBox(),i=await page.getByTestId('photo-image').boundingBox();
   const region=[(f.x-i.x)/i.width,(f.y-i.y)/i.height,f.width/i.width,f.height/i.height];
   if(!expected)expected=region;else region.forEach((v,n)=>assert(Math.abs(v-expected[n])<.001));
   assert(f.width>=20&&f.height>=20);record('dense photo crop remains invariant',{size,frame:f,region});
   assert.equal(await page.getByTestId('touch-surface').getByRole('button').nth(22).getAttribute('aria-label'),'Помоги мне найти любимые вещи');
   await page.screenshot({path:output+'/photo-'+size.width+'.png'});
 }
 await context.setOffline(true);await page.setViewportSize({width:390,height:844});await settle();assert(await page.getByTestId('photo-image').isVisible());record('loaded local photo survives offline rotation','passed; no offline reload claim in this probe');
 await page.getByTestId('touch-surface').getByRole('button').last().focus();await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.__spoken),['All done']);record('photo card keyboard speech target','passed');
 await Promise.all(bundlePromises);result.bundles=[...new Map(result.bundles.map(b=>[b.path,b])).values()];await context.close();
}catch(e){result.error=e.stack;console.error(e);process.exitCode=1;}finally{if(browser)await browser.close();server.kill();fs.writeFileSync(`${output}/result.json`,JSON.stringify(result,null,2));}
