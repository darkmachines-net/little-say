/** @file Records dependency provenance and resolves the exact AppleButton runtime import without invoking native providers. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [folder,phase]=process.argv.slice(2), root=path.resolve(folder);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'apps/mobile/package.json')));
const apple=path.join(root,'node_modules/@invertase/react-native-apple-authentication');
const appleManifest=JSON.parse(fs.readFileSync(path.join(apple,'package.json')));
const button=path.join(apple,'lib/AppleButton.ios.js'), require=createRequire(button);
let resolution;
try { const resolved=require.resolve('prop-types'); const api=require('prop-types'); resolution={resolved,version:require('prop-types/package.json').version,oneOf:typeof api.oneOf,number:typeof api.number}; }
catch(error){resolution={errorCode:error.code,message:error.message};}
const report={phase,checkedAtUtc:new Date().toISOString(),host:process.env.COMPUTERNAME,node:process.version,root,nodeModulesRealPath:fs.realpathSync(path.join(root,'node_modules')),nodeModulesIsSymbolicLink:fs.lstatSync(path.join(root,'node_modules')).isSymbolicLink(),manifestSha256:hash(path.join(root,'apps/mobile/package.json')),lockSha256:hash(path.join(root,'package-lock.json')),declaredPropTypes:manifest.dependencies['prop-types']??null,appleVersion:appleManifest.version,appleDependencies:appleManifest.dependencies??null,applePeerDependencies:appleManifest.peerDependencies??null,appleButtonSha256:hash(button),resolution,lockEntries:Object.fromEntries(Object.entries(lock.packages).filter(([name])=>name.includes('prop-types')||name==='node_modules/object-assign'||name==='node_modules/loose-envify'||name==='node_modules/js-tokens'))};
fs.writeFileSync(`issue43-${phase}-probe.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
