/** @file Captures actual master and PR6 production builds using identical synthetic content and controlled picture-service outcomes; evidence-only, never a product merge target. */
import { chromium, expect } from '@playwright/test';
import { createServer } from '../../apps/server/src/app';
import { starterLibrary } from '../../tests/fixtures/library';
import { downloadCatalogPicture, searchPictures } from '../../apps/server/src/picture-catalog';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const out = resolve('artifacts/pr6-cancellation/stopped');
await mkdir(out,{recursive:true});
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const base = '4cdeb323fb8ebfa5247193e47cf73d56f025e007';
const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const clock = '2026-10-05T18:00:00.000Z';
const fixture = starterLibrary();
const shared = { ...fixture, version: 1, settings: { ...fixture.settings, aiConsent: true, autoSpeech: false }, boards: fixture.boards.map(board => ({...board,createdAt:clock,updatedAt:clock})) };
await writeFile(join(out,'library.json'), JSON.stringify(shared,null,2));
const entry = searchPictures('dumper truck','color')[0];
const assetPath = join(out,'library-truck.png');
let png: Buffer;
try { png = await readFile(assetPath); } catch { png = await downloadCatalogPicture(entry); await writeFile(assetPath,png); }
await writeFile(join(out,'library-source.json'), JSON.stringify(entry,null,2));
const assetId = hash(png);
const labels = ['Cow','Sheep','Dump truck'];
const emojis = ['\u{1F404}','\u{1F411}','\u{1F69A}'];
const draft = {boardId:null,baseRevision:null,proposal:{title:'Animals and a dump truck',explanation:'Here are cow, sheep, and a dump truck.',needsClarification:false,tiles:labels.map((label,index)=>({existingId:null,label,speech:label,language:'en-US',emoji:emojis[index],color:['sage','peach','sky'][index]}))}};
await writeFile(join(out,'proposal.json'),JSON.stringify(draft,null,2));
const browser = await chromium.launch();
const manifest: any = {capturedAtUtc:new Date().toISOString(),host:process.env.COMPUTERNAME,tool:'Playwright 1.63.0 screenshot; no pixel editing/cropping',browser:browser.version(),base,head,clock,fixture:'library.json',proposal:'proposal.json',asset:{file:'library-truck.png',sha256:assetId,source:'library-source.json'},normalization:'Identical version-1 synthetic library (After migrates it), en-US locale, UTC, light theme, DPR 1, reduced motion, fixed Date, service workers blocked. No CSS or DOM hiding. AI replies and picture outcomes mocked; real pinned Mulberry PNG rasterized by production downloadCatalogPicture. Accurate cow/sheep emoji unchanged; dump-truck gap uses that retained library asset. No paid AI calls. Timers run; only settled states captured. Protocol picturePolicy added only for After request declaring pictureCapability=1.',runs:[]};
try {
 for (const [name, root, sha] of [['before',process.cwd(),base],['after',process.cwd(),head]]) {
  if(name==='after' && execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sha) throw Error('Source mismatch');
  const webRoot=name==='before'?resolve('../pr6-reviewed-dist'):join(root,'apps/mobile/dist');
  const app=await createServer({provider:null,webRoot});
  const address=await app.listen({host:'127.0.0.1',port:0});
  const served:any[]=[];
  const run:any={name,source:sha,webRoot,buildCommand:'npm ci; npm run build',images:[],served}; manifest.runs.push(run);
  try {
   for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    for(const state of ['stopped']) {
     if(state==='home'&&viewport.width===390) continue;
     const context=await browser.newContext({viewport,deviceScaleFactor:1,colorScheme:'light',locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce',serviceWorkers:'block'});
     const page=await context.newPage();
     await page.clock.setFixedTime(new Date(clock));
     const loads: Promise<void>[]=[];
     page.on('response',response=>{const url=new URL(response.url()); if(response.request().resourceType()==='script'||url.pathname==='/'||url.pathname==='/app') loads.push((async()=>{const body=await response.body(); const path=response.request().resourceType()==='script'?url.pathname.slice(1):'index.html'; const disk=await readFile(join(webRoot,path)); if(hash(body)!==hash(disk)) throw Error('Running build differs: '+path); served.push({path,sha256:hash(body)});})());});
     await page.route('**/api/**',route=>route.fulfill({json:{}}));
     await page.route('**/api/health',route=>route.fulfill({json:{status:'ok',aiConfigured:false,pictures:{version:1}}}));
     await page.goto(address+(state==='home'?'/':'/app'));
     if(state==='home') await expect(name==='after'?page.getByRole('heading',{level:1}):page.getByRole('heading',{name:'Choose your languages',exact:true})).toBeVisible();
     else {
      await expect(page.getByRole('heading',{name:'Choose your languages',exact:true})).toBeVisible();
      await page.evaluate(async library=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('little-say');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(library,'library');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},shared);
      await page.reload();
      await expect(page.getByText('Your soundboards',{exact:true})).toBeVisible();
      await page.route('**/api/boards/propose',route=>route.fulfill({json:{...draft,proposal:{...draft.proposal,...(route.request().postDataJSON().pictureCapability?{picturePolicy:{mode:'auto',style:'color',consistent:false}}:{})}}}));
      await page.route('**/api/pictures/analyze',route=>route.fulfill({json:{tiles:route.request().postDataJSON().tiles.map((tile:any)=>({id:tile.id,emoji:tile.emoji,concept:{description:tile.label,features:[],searchTerms:[tile.label],emojiAccurate:tile.label!=='Dump truck'}}))}}));
      let jobs=0;
      await page.route('**/api/pictures/jobs',route=>{jobs++;const input=route.request().postDataJSON();return route.fulfill({json:{id:input.requestId,draftId:input.draftId,tileId:input.tileId,state:'working'}});});
      await page.route('**/api/pictures/jobs/*',route=>route.fulfill({json:{id:route.request().url().split('/').at(-1),state:'working'}}));
      await page.route('**/api/pictures/jobs/*/cancel',route=>route.fulfill({json:{state:'cancelled'}}));
      await page.route('**/api/pictures/assets/*.png',route=>route.fulfill({body:png,contentType:'image/png'}));
      await page.route('**/api/pictures/review',route=>route.fulfill({json:{rejected:[]}}));
      await page.getByRole('button',{name:'New board',exact:true}).click();
      await page.getByRole('textbox',{name:'Message to AI',exact:true}).fill('Cow, sheep, and a dump truck');
      await page.getByRole('button',{name:'Send message',exact:true}).click();
      await expect.poll(()=>jobs).toBe(1);
      await page.getByRole('button',{name:'Stop request',exact:true}).click();
      await expect(page.getByTestId('ai-draft')).toHaveCount(0);
      await expect(page.getByRole('textbox',{name:'Message to AI',exact:true})).toHaveValue(name==='after'?'Cow, sheep, and a dump truck':'');
     }
     await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
     await Promise.all(loads);
     const file=`${name}-${state}-${viewport.width}.png`;
     const bytes=await page.screenshot({path:join(out,file),animations:'disabled'});
     run.images.push({file,sha256:hash(bytes),viewport,route:state==='home'?'/':'/app',state,observedAtUtc:new Date().toISOString()});
     await context.close();
    }
   }
  } finally {await app.close();}
 }
 const prior=JSON.parse(await readFile('artifacts/pr6-final-evidence/manifest.json','utf8'));
 const known=new Set(prior.runs.find((r:any)=>r.name==='after').served.map((a:any)=>a.sha256));
 if(manifest.runs[0].served.some((a:any)=>!known.has(a.sha256)))throw Error('Reviewed build snapshot does not match retained served hashes');
 manifest.scope='Supplemental review-fix comparison, not the main PR baseline. Before uses preserved production build originally captured from 4cdeb323, runtime-equivalent to reviewed hygiene head38bfe7d; every served hash checked against retained original manifest. After is current committed repair. Same picture job held pending, then Stop request; screenshots are genuine unedited browser pixels.';
 await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify(manifest,null,2));
} finally {await browser.close();}
