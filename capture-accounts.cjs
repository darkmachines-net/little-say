// Disposable capture harness retained only with review evidence, never product history.
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), {spawn}=require('node:child_process');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(__dirname,'browsers');
const {chromium}=require('./little-say-accounts/node_modules/playwright');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const output=path.join(__dirname,'account-evidence');fs.mkdirSync(output,{recursive:true});
const sources=[{name:'before',root:'accounts-before',sha:'344aded5566e310a703ffe48312bb26d8de77fef',port:4191},{name:'after',root:'little-say-accounts',sha:'74b721d095d0bd867ecaf5c093bfcf2c03e87eec',port:4192}];
async function capture(source){
 const root=path.join(__dirname,source.root),origin=`http://127.0.0.1:${source.port}`;
 const log=fs.openSync(path.join(output,source.name+'-server.log'),'w');
 const server=spawn(process.execPath,['dist/index.js'],{cwd:path.join(root,'apps/server'),windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PORT:String(source.port),HOST:'127.0.0.1',NODE_ENV:'test',ALLOWED_ORIGINS:origin,WEB_ROOT:path.join(root,'apps/mobile/dist'),AAC_OPENAI_KEY:'',OPENAI_API_KEY:'',CHATGPT_ENABLED:'false',FIREBASE_PROJECT_ID:'',FIREBASE_AUTH_EMULATOR_HOST:'',FIREBASE_AUTH_EMULATOR_URL:''}});
 let browser;
 try{
  let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Owned server exited');try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Server did not become ready');
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1180,height:900},deviceScaleFactor:1,colorScheme:'light',locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce'});const page=await context.newPage();
  await page.addInitScript(()=>{const RealDate=Date;const fixed=Date.parse('2026-10-06T04:00:00Z');window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};});
  const loaded=[];const pending=[];page.on('response',response=>{if(/\/_expo\/static\/js\/web\/.+\.js$/.test(new URL(response.url()).pathname)) pending.push((async()=>{const bytes=await response.body();if(!bytes.length)throw Error('Empty loaded JS');const pathname=new URL(response.url()).pathname;const disk=fs.readFileSync(path.join(root,'apps/mobile/dist',pathname));if(hash(bytes)!==hash(disk))throw Error('Loaded bundle differs from owned build');loaded.push({path:pathname,bytes:bytes.length,sha256:hash(bytes)});})());});
  await page.goto(origin+'/app');await page.getByRole('heading',{name:'Choose your languages',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,source.name+'-setup.png')});
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Start without starter boards',exact:true}).click();await page.getByRole('button',{name:'Parent settings',exact:true}).click();await page.getByRole('button',{name:'Save settings',exact:true}).waitFor();await page.waitForTimeout(500);await page.screenshot({path:path.join(output,source.name+'-settings.png')});
  await Promise.all(pending);if(!loaded.length||!loaded.some(b=>b.path.includes('/App-')))throw Error('No actually loaded application bundle');
  return {...source,capturedAt:new Date().toISOString(),serverPid:server.pid,browser:await browser.version(),loadedBundles:loaded,serverBundleSha256:hash(fs.readFileSync(path.join(root,'apps/server/dist/index.js'))),images:['setup','settings'].map(state=>{let file=source.name+'-'+state+'.png';return {state,file,sha256:hash(fs.readFileSync(path.join(output,file)))}})};
 }finally{await browser?.close();server.kill();await new Promise(r=>server.once('exit',r));fs.closeSync(log);}
}
(async()=>{let records=[];for(const source of sources)records.push(await capture(source));fs.copyFileSync(__filename,path.join(output,'capture-accounts.cjs'));fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({records,fixture:'Fresh browser storage; default languages; Continue; Start without starter boards; Parent settings. No credentials or account endpoint fixtures.',normalization:'Identical UTC clock, locale, viewport, scale, light theme and reduced motion. No UI hidden, no image alteration.',harnessSha256:hash(fs.readFileSync(__filename)),sourceArchiveSha256:hash(fs.readFileSync(path.join(__dirname,'accounts-before-source.zip')))},null,2)+'\n');console.log(JSON.stringify(records.map(r=>({state:r.name,bundles:r.loadedBundles.length,images:r.images})),null,2));})().catch(e=>{console.error(e);process.exitCode=1});
