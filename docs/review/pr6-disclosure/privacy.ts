/** @file Captures actual master, reviewed PR6 and repaired PR6 UI; retained evidence only. */
import { chromium, expect } from '@playwright/test';
import { createServer } from '../../apps/server/src/app';
import { starterLibrary } from '../../tests/fixtures/library';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const out=resolve('artifacts/pr6-disclosure');
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const base='5d72992c77fbb09195518e257d799501b7db4d04', reviewed='250d9a055a2c437360227528919d702e8f6196f7';
const clock='2026-10-05T18:00:00.000Z';
const fixture=starterLibrary();
const library={...fixture,version:1,settings:{...fixture.settings,aiConsent:true,autoSpeech:false},boards:fixture.boards.map(board=>({...board,createdAt:clock,updatedAt:clock}))};
await writeFile(join(out,'library.json'),JSON.stringify(library,null,2));
const browser=await chromium.launch();
const manifest:any={base,reviewed,head,capturedAtUtc:new Date().toISOString(),host:process.env.COMPUTERNAME,browser:browser.version(),tool:'Playwright1.63 screenshot',clock,fixture:'library.json',steps:'Seed same synthetic version1 library; privacy: open Parent settings and scroll Storage & privacy into view. tile-close: open Farmyard friends, change Cow to Calf, Save tile, close automatically-started Board pictures (master has no picture preview), inspect editor and persisted library. Mock picture jobs remain pending; no paid provider calls.',normalization:'1280x1000, DPR1, light, en-US/UTC, reduced motion, fixed Date, service workers blocked. No CSS/DOM hiding, cropping, or pixel edits. Real scrolling only. All script/HTML response digests verified against served production files.',runs:[]};
try{
 for(const [name,source,webRoot] of [['base',base,resolve('../little-say-base/apps/mobile/dist')],['reviewed',reviewed,resolve('../pr6-reviewed-lifecycle-dist')],['after',head,resolve('apps/mobile/dist')]]){
  const app=await createServer({provider:null,webRoot});const address=await app.listen({host:'127.0.0.1',port:0});const run:any={name,source,webRoot,buildCommand:'npm ci; npm run build',served:[],images:[]};manifest.runs.push(run);
  try{for(const state of ['privacy']){
   const context=await browser.newContext({viewport:{width:1280,height:1000},deviceScaleFactor:1,colorScheme:'light',locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'});const page=await context.newPage();await page.clock.setFixedTime(new Date(clock));
   const loads:Promise<void>[]=[];page.on('response',response=>{const url=new URL(response.url());if(response.request().resourceType()==='script'||url.pathname==='/app')loads.push((async()=>{const bytes=await response.body();const path=response.request().resourceType()==='script'?url.pathname.slice(1):'index.html';if(hash(bytes)!==hash(await readFile(join(webRoot,path))))throw Error('Unexpected served bytes');run.served.push({path,sha256:hash(bytes)});})());});
   await page.route('**/api/**',route=>route.fulfill({json:{}}));await page.route('**/api/health',route=>route.fulfill({json:{status:'ok',aiConfigured:false,pictures:{version:1}}}));
   await page.route('**/api/pictures/analyze',route=>{const body=route.request().postDataJSON();return route.fulfill({json:{tiles:body.tiles.map((tile:any)=>({id:tile.id,emoji:tile.emoji,concept:{description:tile.label,searchTerms:[tile.label],features:[],emojiAccurate:false}}))}});});
   const jobs:any[]=[];await page.route('**/api/pictures/jobs',route=>{const j=route.request().postDataJSON();jobs.push(j);return route.fulfill({json:{id:j.requestId,draftId:j.draftId,tileId:j.tileId,state:'working'}});});
   await page.route('**/api/pictures/jobs/*',route=>{const id=route.request().url().split('/').at(-1);const j=jobs.find(j=>j.requestId===id);return route.fulfill({json:{id,draftId:j?.draftId,tileId:j?.tileId,state:'working'}});});
   await page.route('**/api/pictures/jobs/*/cancel',route=>route.fulfill({json:{}}));
   await page.goto(address+'/app');await expect(page.getByRole('heading',{name:'Choose your languages',exact:true})).toBeVisible();
   await page.evaluate(async library=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('little-say');r.onsuccess=()=>resolve(r.result);});await new Promise<void>(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(library,'library');tx.oncomplete=()=>resolve();});db.close();},library);await page.reload();await expect(page.getByText('Your soundboards',{exact:true})).toBeVisible();
   if(state==='privacy'){await page.getByRole('button',{name:'Parent settings',exact:true}).click();await page.getByText('Storage & privacy',{exact:true}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'OpenAI data policy',exact:true}).scrollIntoViewIfNeeded();}
   else{await page.getByRole('button',{name:'Edit Farmyard friends',exact:true}).click();await page.getByRole('button',{name:'Edit tile Cow',exact:true}).click();await page.getByRole('textbox',{name:'Words on the tile',exact:true}).fill('Calf');await page.getByRole('button',{name:'Save tile',exact:true}).click();if(name!=='base'){await expect.poll(()=>jobs.length).toBeGreaterThan(0);await page.getByRole('button',{name:'Close Board pictures',exact:true}).click();}await expect(page.getByRole('button',{name:name==='reviewed'?'Edit tile Cow':'Edit tile Calf',exact:true})).toBeVisible();}
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});await Promise.all(loads);
   const file=name+'-'+state+'.png';const bytes=await page.screenshot({path:join(out,file),animations:'disabled'});run.images.push({file,sha256:hash(bytes),state,route:'/app',observedAtUtc:new Date().toISOString()});await context.close();
  }}finally{await app.close();}
 }
 const prior=JSON.parse(await readFile('artifacts/pr6-policy/manifest.json','utf8'));const known=new Set(prior.runs.find((r:any)=>r.name==='after').served.map((v:any)=>v.sha256));if(manifest.runs[1].served.some((v:any)=>!known.has(v.sha256)))throw Error('Reviewed build differs from retained manifest');
 manifest.reviewedBuildApplicability='Reviewed250d9a mobile tree equals1e857c per selection source-impact record; served bytes match retained a1d42e policy After manifest. The250 build was copied before edits.';
 await writeFile(join(out,'privacy-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
}finally{await browser.close();}
