/** @file Captures synthetic Android safe-area review screens and UI bounds, restoring emulator settings. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const kind = process.argv[2];
if (!['baseline', 'head'].includes(kind)) throw new Error('Expected baseline or head.');
const adbPath = resolve(process.env.ANDROID_HOME, 'platform-tools/adb.exe');
const directory = resolve('artifacts/pr-safe-area', kind);
mkdirSync(directory, { recursive: true });
const adb = (...args) => execFileSync(adbPath, ['-s', 'emulator-5554', ...args], { timeout: 30000 });
const shell = (...args) => adb('shell', ...args).toString();
const delay = ms => new Promise(done => setTimeout(done, ms));
function tree() { return adb('exec-out', 'uiautomator', 'dump', '/dev/tty').toString(); }
function nodeBounds(xml, label) {
  const node = xml.match(/<node\b[^>]*>/g)?.find(node => node.includes(`content-desc="${label}"`));
  const match = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  return match && match.slice(1).map(Number);
}
function tap(label) {
  const bounds = nodeBounds(tree(), label);
  if (!bounds) throw new Error(`No UI node: ${label}`);
  const [left, top, right, bottom] = bounds;
  shell('input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
}
async function capture(name) {
  await delay(600);
  const xml = tree();
  writeFileSync(resolve(directory, `${name}.xml`), xml);
  writeFileSync(resolve(directory, `${name}.png`), adb('exec-out', 'screencap', '-p'));
  const insets = shell('dumpsys', 'window').split('\n').filter(line => /type=(statusBars|navigationBars|displayCutout) frame=/.test(line));
  const bounds = { close: nodeBounds(xml, 'Close Parent settings'), save: nodeBounds(xml, 'Save settings'), back: nodeBounds(xml, 'Back') };
  writeFileSync(resolve(directory, `${name}.json`), JSON.stringify({ bounds, insets: [...new Set(insets.map(line => line.trim()))] }, null, 2));
  console.log(JSON.stringify({ kind, name, bounds }));
}
const originalRotation = shell('settings', 'get', 'system', 'user_rotation').trim();
const originalAuto = shell('settings', 'get', 'system', 'accelerometer_rotation').trim();
const originalNav = shell('cmd', 'overlay', 'list').split('\n').find(line => /^\[x\] com.android.internal.systemui.navbar\./.test(line))?.slice(4).trim();
try {
  const apk = resolve('apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk');
  const bundleInfo = JSON.parse(readFileSync(resolve(directory, 'bundle.json'), 'utf8'));
  writeFileSync(resolve(directory, 'build.json'), JSON.stringify({ ...bundleInfo, apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), androidVersion: shell('getprop', 'ro.build.version.release').trim(), sdk: shell('getprop', 'ro.build.version.sdk').trim(), package: 'net.darkmachines.littlesay', fixture: 'English guest setup complete; empty local library; no account or generated content' }, null, 2));
  console.log(adb('install', '-r', apk).toString());
  shell('input', 'keyevent', 'KEYCODE_WAKEUP');
  shell('wm', 'dismiss-keyguard');
  shell('settings', 'put', 'system', 'accelerometer_rotation', '0');
  shell('settings', 'put', 'system', 'user_rotation', '0');
  shell('cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.gestural');
  shell('am', 'force-stop', 'net.darkmachines.littlesay');
  shell('am', 'start', '-n', 'net.darkmachines.littlesay/.MainActivity');
  for (let attempt = 0; attempt < 15; attempt++) {
    await delay(1000);
    if (nodeBounds(tree(), 'Parent settings')) break;
  }
  tap('Parent settings');
  await capture('settings-gesture');
  shell('cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.threebutton');
  await capture('settings-threebutton');
  shell('settings', 'put', 'system', 'user_rotation', '1');
  await capture('settings-landscape');
  shell('settings', 'put', 'system', 'user_rotation', '0');
  await delay(1000);
  tap('Log in or create an account');
  await capture('account-threebutton');
  shell('input', 'keyevent', '4');
  shell('input', 'keyevent', '4');
} finally {
  shell('settings', 'put', 'system', 'user_rotation', originalRotation);
  shell('settings', 'put', 'system', 'accelerometer_rotation', originalAuto);
  if (originalNav) shell('cmd', 'overlay', 'enable-exclusive', '--category', originalNav);
}
