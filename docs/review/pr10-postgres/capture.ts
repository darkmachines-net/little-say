/** @file Captures matched synthetic settings and rejected-draft states from isolated parent and child builds. */
import { chromium, expect } from '@playwright/test';
import { starterLibrary } from '../tests/fixtures/library';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
const out=resolve('../evidence');mkdirSync(out,{recursive:true});
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const record:any={purpose:'Matched actual-parent-to-child UI evidence; synthetic data only',owner:'PR10 continuation',retention:'Through human review and stack completion; non-product evidence ref',clock:'2026-10-05T12:00:00Z',viewport:{width:1180,height:900},deviceScaleFactor:1,colorScheme:'light',normalization:'No UI hiding or pixel edits. Fresh context, service workers blocked, fixed browser Date; animations disabled only during screenshots.',sources:[]};
for(const [name,root] of [['before',resolve('../little-say-before')],['after',process.cwd()]]){
 const source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const dist=resolve(root,'apps/mobile/dist');
 const inventory=(dir:string):any[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?inventory(resolve(dir,e.name)):[{path:relative(root,resolve(dir,e.name)).replaceAll('\\','/'),sha256:hash(readFileSync(resolve(dir,e.name)))}]);
 const server=spawn(process.execPath,['dist/index.js'],{cwd:resolve(root,'apps/server'),env:{...process.env,PORT:'4187',HOST:'127.0.0.1',WEB_ROOT:dist,ALLOWED_ORIGINS:'http://127.0.0.1:4187',CHATGPT_ENABLED:'false',OPENAI_API_KEY:'',AAC_OPENAI_KEY:''},stdio:'ignore',windowsHide:true});
 try {
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4187/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const browser=await chromium.launch({channel:'msedge'});try{
 const context=await browser.newContext({viewport:record.viewport,deviceScaleFactor:1,colorScheme:'light',serviceWorkers:'block'});const page=await context.newPage();await page.clock.setFixedTime(new Date(record.clock));
 const status={available:true,selected:true,connected:true,planEnabled:true,needsLogin:false,welcome:false,email:'parent@example.com'};
 await page.route('**/api/chatgpt/status',route=>route.fulfill({json:status}));
 await page.route('**/api/boards/propose',route=>route.fulfill({status:429,json:{error:'Synthetic usage limit reached. Try again later.'}}));
 await page.goto('http://127.0.0.1:4187/app');await expect(page.getByRole('heading',{name:'Choose your languages',exact:true})).toBeVisible();
 const library=starterLibrary();for(const b of library.boards){b.createdAt=record.clock;b.updatedAt=record.clock;}
 await page.evaluate(async library=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('little-say');r.onsuccess=()=>resolve(r.result);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(library,'library');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},library);
 await page.reload();await expect(page.getByText('Your soundboards',{exact:true})).toBeVisible();
 const loaded=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(s=>s.includes('/_expo/static/js/')));
 for(const url of loaded){const path=new URL(url).pathname;const bytes=Buffer.from(await (await fetch(url)).arrayBuffer());if(hash(bytes)!==hash(readFileSync(resolve(dist,'.'+path))))throw Error('Served bundle mismatch');}
 await page.getByRole('button',{name:'Parent settings',exact:true}).click();
 if(name==='after')await expect(page.getByText('parent@example.com',{exact:true})).toBeVisible();
 await page.screenshot({path:resolve(out,name+'-settings.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Close Parent settings',exact:true}).click();await page.getByRole('button',{name:'New board',exact:true}).click();
 await page.getByRole('textbox',{name:'Message to AI',exact:true}).fill('A farm board');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByText('Synthetic usage limit reached. Try again later.',{exact:true})).toBeVisible();
 await page.screenshot({path:resolve(out,name+'-limit.png'),animations:'disabled'});
 record.sources.push({name,source,browser:browser.version(),time:new Date().toISOString(),route:'/app',fixture:library,status,loadedBundles:loaded,build:inventory(dist),serverSha256:hash(readFileSync(resolve(root,'apps/server/dist/index.js'))),captures:['settings','limit'].map(state=>({state,file:name+'-'+state+'.png',sha256:hash(readFileSync(resolve(out,name+'-'+state+'.png')))}))});
 }finally{await browser.close();}
 }finally{server.kill();await new Promise(r=>server.once('exit',r));}
}
record.steps='npm run build in each isolated checkout; npx tsx artifacts/capture.ts. Seed starterLibrary at fixed timestamps in fresh IndexedDB. Open Parent settings, capture. Close; New board; type A farm board; send mocked 429; capture. Same status and error routes supplied to both builds; baseline has no ChatGPT status consumer. Both actual servers keep activation off.';
writeFileSync(resolve(out,'manifest.json'),JSON.stringify(record,null,2));
