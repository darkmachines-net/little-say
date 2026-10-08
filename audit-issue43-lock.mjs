/** @file Audits every lock entry against the preserved pre-fix lock and rejects unrelated dependency churn. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const before=JSON.parse(fs.readFileSync('issue43-baseline-lock.json'));
const after=JSON.parse(fs.readFileSync('little-say-issue43/package-lock.json'));
const changed=[],added=[],removed=[];
for(const [key,value] of Object.entries(before.packages)) {
  if(!after.packages[key])removed.push(key);
  else if(JSON.stringify(value)!==JSON.stringify(after.packages[key]))changed.push({path:key,before:value,after:after.packages[key]});
}
for(const [key,value] of Object.entries(after.packages))if(!before.packages[key])added.push({path:key,value});
if(removed.length||changed.length!==1||changed[0].path!=='apps/mobile'||added.length!==2||!added.some(e=>e.path==='node_modules/prop-types')||!added.some(e=>e.path==='node_modules/prop-types/node_modules/react-is'))throw new Error('Unexpected lockfile scope');
const prior=structuredClone(changed[0].after);delete prior.dependencies['prop-types'];if(JSON.stringify(prior)!==JSON.stringify(changed[0].before))throw new Error('Unrelated workspace metadata drift');
for(const item of added)if(item.value.dev||item.value.optional||!item.value.resolved.startsWith('https://registry.npmjs.org/'))throw new Error('Unexpected classification or source');
const expected={...after};delete expected.packages;const original={...before};delete original.packages;if(JSON.stringify(expected)!==JSON.stringify(original))throw new Error('Root lock metadata drift');
const report={checkedAtUtc:new Date().toISOString(),baseline:'fabb925cf5ee11171d5668af7c2bab44ec9fc613',finalSource:'a570b52c357cddf45d2f5371842e8855f32be8b3',node:process.version,npm:'12.0.1',packageManagerRationale:'Repository uses npm/lockfile v3 and Node24 CI, with no exact npm pin. Current host npm12.0.1 produced only the required entries.',changed,added,removed,existingPackageVersionsIntegrityAndClassificationsUnchanged:true,dependencyRationale:'AppleButton.ios.js imports prop-types for oneOf and number. App declares ^15.8.1 in production dependencies, matching its semver conventions; the lock pins 15.8.1 and nested react-is16.13.1. Existing loose-envify1.4.0/object-assign4.1.1/js-tokens4.0.0 are reused unchanged. No Apple-auth/React upgrade.',beforeLockSha256:createHash('sha256').update(fs.readFileSync('issue43-baseline-lock.json')).digest('hex'),afterLockSha256:createHash('sha256').update(fs.readFileSync('little-say-issue43/package-lock.json')).digest('hex')};
fs.writeFileSync('issue43-lock-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({changed:changed.map(x=>x.path),added:added.map(x=>x.path),removed,existingPackageVersionsIntegrityAndClassificationsUnchanged:true},null,2));
