/** @file Records final published implementation bindings and preserves exact body/evidence verification for independent QA. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const out='evidence-publish';
const bindings=JSON.parse(fs.readFileSync(`${out}/bindings.json`));
const body=JSON.parse(fs.readFileSync('final-body-readback.json'));
const checks=JSON.parse(fs.readFileSync(`${out}/checks.json`));
const evidence=JSON.parse(fs.readFileSync('evidence-verification.json'));
if(bindings.head!==body.head||bindings.prBodySha256!==body.prBodySha256||!checks.check_runs.length||checks.check_runs.some(c=>c.conclusion!=='success'||c.head_sha!==bindings.head))throw new Error('Final bindings or CI differ');
fs.writeFileSync(`${out}/publication-final.json`,JSON.stringify({...bindings,prBodyUpdatedAt:body.updated_at,body:body.body,evidence,ci:checks.check_runs.map(c=>({name:c.name,head:c.head_sha,status:c.status,conclusion:c.conclusion,url:c.html_url})),feedbackDisposition:{R1:'Resolved: ordinary target merge preserves account and prompt exports.',R2:'Resolved: final body compares actual master with final source and links fresh capture identities.',nativeEsm:'Resolved: current-head CI account-browser gate passes after scoped JSON/helper loading correction.',bot:'Quota-only refusal remains accurately disclosed; no completed bot review.',unresolved:'iOS Metro export missing prop-types in target account dependency; reproduced on both baseline and final source, disclosed, no scope expansion.'},owner:'01a11ca6-7faa-7628-8031-ac89bc018019',sameIndependentQa:'01a11c7c-11db-70b8-ba73-efe3693b003e',sourceFrozenForQa:true,originalWorktreesUntouched:true,productTrackedTreeClean:true,retainedLocalBuildOutput:'apps/mobile/dist-native',readiness:'Not awarded; draft=true, no labels. Independent QA and coordinator gates remain.'},null,2)+'\n');
fs.copyFileSync('final-body-readback.json',`${out}/final-body-readback.json`);
fs.copyFileSync('evidence-verification.json',`${out}/final-evidence-verification.json`);
fs.copyFileSync('checkpoint-final.mjs',`${out}/checkpoint-final.mjs`);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!=='.git').flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
fs.writeFileSync(`${out}/manifest.json`,JSON.stringify({generatedAtUtc:new Date().toISOString(),source:bindings.head,baseline:bindings.actualTarget,behaviorEvidenceCommit:evidence.evidenceCommit,artifacts:walk(out).filter(f=>path.basename(f)!=='manifest.json').map(f=>({file:path.relative(out,f).replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(f)).digest('hex')}))},null,2)+'\n');
