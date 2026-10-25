/** @file Release contract: metadata stamping, native compatibility and internal delivery through Play and TestFlight. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { stamp } from './hooks.mjs';
import { sourceEnvironment } from '@mchartier/expo-release';
import { selectRelease } from '@mchartier/expo-release/engine';
const root=fileURLToPath(new URL('../../',import.meta.url));
const config=JSON.parse(fs.readFileSync(path.join(root,'release.config.json')));
const allocation={server:true,native:true,bump:'major',versions:{server:'0.99.0',mobile:'1.0.0'},pair:[101,102]};

test('version stamping changes only declared application metadata', t => {
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'release-metadata-'));
  t.after(()=>fs.rmSync(copy,{recursive:true,force:true}));
  for(const file of config.metadataFiles){const destination=path.join(copy,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);}
  stamp(copy,allocation);
  const app=JSON.parse(fs.readFileSync(path.join(copy,'apps/mobile/app.json')));
  assert.equal(app.expo.version,'1.0.0');
  const release=JSON.parse(fs.readFileSync(path.join(copy,'native-release.json')));
  assert.equal(release.version,'1.0.0');assert.equal(release.androidVersionCode,5);assert.equal(release.iosBuildNumber,'5');
});

test('OTA patch stamps the bundle version without manufacturing a new binary build number', t => {
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'release-ota-metadata-'));
  t.after(()=>fs.rmSync(copy,{recursive:true,force:true}));
  for(const file of config.metadataFiles){const destination=path.join(copy,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);}
  stamp(copy,{...allocation,server:false,native:false,bump:'patch',versions:{mobile:'1.1.2'}});
  const release=JSON.parse(fs.readFileSync(path.join(copy,'native-release.json')));
  assert.equal(release.version,'1.1.2');assert.equal(release.androidVersionCode,5);assert.equal(release.iosBuildNumber,'5');
});

test('the real Expo SDK ignores stamped versions but retains native compatibility', {timeout:180000}, () => {
  const app=path.join(root,'apps/mobile'),require=createRequire(path.join(app,'package.json'));
  const sdk=require.resolve('@expo/fingerprint');
  const platforms=['android','ios'];
  const fingerprint=(platform,profile='production')=>JSON.parse(execFileSync(process.execPath,['-e',
    'require(process.argv[1]).createFingerprintAsync(process.cwd(),{platforms:[process.argv[2]],silent:true}).then(x=>console.log(JSON.stringify(x)))',sdk,platform],
    {cwd:app,env:{...sourceEnvironment(config.profiles[profile].publicEnvironment),EAS_BUILD_PLATFORM:platform,EAS_BUILD_PROFILE:profile},encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}));
  const before=Object.fromEntries(platforms.map(p=>[p,fingerprint(p)]));
  const originals=new Map([...config.metadataFiles,'apps/mobile/eas.json'].map(file=>[file,fs.readFileSync(path.join(root,file))]));
  try {
    stamp(root,allocation);
    for(const platform of platforms){const after=fingerprint(platform);assert.equal(after.hash,before[platform].hash);
      assert.ok(after.sources.some(source=>source.id=== 'expoAutolinkingConfig:'+platform || source.reasons.some(reason=>reason.includes('Autolinking'))));}
    const store=Object.fromEntries(platforms.map(platform=>[platform,fingerprint(platform,'internal').hash]));
    const easFile=path.join(app,'eas.json'),directInstall=JSON.parse(originals.get('apps/mobile/eas.json'));
    directInstall.build.internal.distribution='internal';directInstall.build.internal.android.buildType='apk';
    fs.writeFileSync(easFile,JSON.stringify(directInstall));
    for(const platform of platforms)assert.notEqual(fingerprint(platform,'internal').hash,store[platform],'Store builds require a fresh native compatibility baseline.');
    fs.writeFileSync(easFile,originals.get('apps/mobile/eas.json'));
    const file=path.join(app,'app.json'),changed=JSON.parse(fs.readFileSync(file));
    changed.expo.android.permissions=[...(changed.expo.android.permissions??[]),'android.permission.VIBRATE'];
    fs.writeFileSync(file,JSON.stringify(changed));
    assert.notEqual(fingerprint('android').hash,before.android.hash,'Native permission changes must invalidate compatibility.');
  } finally {for(const [file,bytes] of originals)fs.writeFileSync(path.join(root,file),bytes);}
});

test('configured identity, approval environments and destinations remain explicit', () => {
  assert.equal(config.schemaVersion,3);assert.equal(config.server.deployment.service,'little-say');
  assert.ok(config.profiles.production.approvalEnvironment);assert.equal(config.profiles.production.deployEnvironment,'self-hosted-testing');
  const eas=JSON.parse(fs.readFileSync(path.join(root,'apps/mobile/eas.json')));
  assert.equal(eas.cli.version,'25.3.0');
  assert.equal(eas.cli.appVersionSource,'remote');
  assert.equal(eas.build.internal.autoIncrement,true);assert.equal(eas.build.production.autoIncrement,true);
  for (const profile of ['internal', 'production']) {
    assert.equal(config.profiles[profile].submit,true);
    assert.equal(eas.build[profile].distribution,'store');
    assert.equal(eas.build[profile].android.buildType,'app-bundle');
    assert.notEqual(eas.build[profile].ios?.simulator,true);
    assert.equal(eas.submit[profile].ios.ascAppId,'6826487372');
  }
  assert.equal(config.profiles.internal.approvalEnvironment,'internal');
  assert.equal(config.profiles.internal.environment,'preview');assert.equal(eas.build.internal.channel,'internal');
  assert.deepEqual(eas.submit.internal.android,{track:'internal',releaseStatus:'completed'});
  assert.deepEqual(eas.submit.production.android,{track:'internal',releaseStatus:'draft'});
});

test('internal native releases submit both platforms while compatible OTA releases skip submission', () => {
  const releaseConfig={...config,mobile:{...config.mobile,platforms:['android','ios']}};
  const observation={server:'server',family:'native',js:{android:'bundle',ios:'bundle'},fingerprints:{internal:{android:'android',ios:'ios'}}};
  const native=selectRelease(releaseConfig,'internal',observation);
  assert.equal(native.native,true);
  for(const platform of releaseConfig.mobile.platforms)assert.ok(native.operations.includes(`internal/submit/${platform}`));
  const history={mobile:{version:native.versions.mobile,family:observation.family},server:{version:native.versions.server},baselines:{'internal/deploy/server':{input:observation.server}}};
  for(const platform of releaseConfig.mobile.platforms){
    history.baselines[`internal/build/${platform}`]={runtime:native.runtime,fingerprint:observation.fingerprints.internal[platform]};
    history.baselines[`internal/js/${platform}`]={input:'previous-bundle'};
  }
  const ota=selectRelease(releaseConfig,'internal',observation,history);
  assert.equal(ota.native,false);assert.equal(ota.bump,'patch');assert.deepEqual(ota.ota,['android','ios']);
  assert.ok(ota.operations.every(operation=>!operation.includes('/submit/')));
});
