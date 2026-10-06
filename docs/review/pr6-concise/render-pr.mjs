/** @file Renders the exact GitHub API body_html with authenticated repository image bytes for evidence inspection; does not claim full GitHub-page inspection. */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const mode=process.argv[2]||'original';
const out=path.resolve('artifacts/pr6-final-evidence');
const pr=JSON.parse(execFileSync('gh',['api','repos/MChartier/little-say/pulls/6','-H','Accept: application/vnd.github.full+json'],{encoding:'utf8',maxBuffer:10e6}));
const sha=b=>createHash('sha256').update(b).digest('hex');
fs.writeFileSync(path.join(out,`${mode}-pr-body.md`),pr.body);
fs.writeFileSync(path.join(out,`${mode}-pr-body.html`),pr.body_html);
const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1400,height:1100},deviceScaleFactor:1});
const images=[];
await page.route('**/*',async route=>{try { const url=new URL(route.request().url());const match=url.pathname.match(/^\/MChartier\/little-say\/(?:blob|raw)\/([a-f0-9]{40})\/(.+)$/); if(!match) return route.abort();const data=JSON.parse(execFileSync('gh',['api',`repos/MChartier/little-say/contents/${match[2]}?ref=${match[1]}`],{encoding:'utf8',maxBuffer:10e6}));const bytes=Buffer.from(data.content,'base64');images.push({url:url.href,commit:match[1],path:match[2],sha256:sha(bytes)});await route.fulfill({body:bytes,contentType:'image/png'});}catch(error){console.error(String(error));await route.abort();}});
await page.setContent('<!doctype html><meta charset="utf-8"><style>body{font:16px/1.5 system-ui;color:#1f2328;margin:35px auto;max-width:1200px}table{border-collapse:collapse}td,th{border:1px solid #d1d9e0;padding:8px}img{max-width:100%;height:auto}a{color:#0969da}code{overflow-wrap:anywhere}</style>'+pr.body_html,{waitUntil:'networkidle'});
const loaded=await page.locator('img').evaluateAll(imgs=>imgs.map(img=>({src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0,width:img.naturalWidth,height:img.naturalHeight})));
if(loaded.some(img=>!img.loaded))throw Error('Image failed to load');
const height=await page.evaluate(()=>document.documentElement.scrollHeight);
for(let y=0,index=0;y<height;y+=1000,index++){await page.evaluate(y=>window.scrollTo(0,y),y);await page.screenshot({path:path.join(out,`${mode}-render-${index}.png`)});}
fs.writeFileSync(path.join(out,`${mode}-render-readback.json`),JSON.stringify({checkedAtUtc:new Date().toISOString(),head:pr.head.sha,base:pr.base.sha,bodySha256:sha(pr.body),bodyHtmlSha256:sha(pr.body_html),scope:'Exact API-rendered body_html with authenticated repository image routing. Full authenticated GitHub-page layout unavailable: CUA kernel fails applying sandbox ACLs. Browser UI access not claimed.',loaded,images},null,2));
console.log(JSON.stringify({head:pr.head.sha,base:pr.base.sha,bodySha256:sha(pr.body),images:loaded.length,height}));await browser.close();
