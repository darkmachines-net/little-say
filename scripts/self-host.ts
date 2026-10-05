/** @file Builds a local self-host stack, migrates its selected database, and waits for app readiness without removing volumes. */
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
config({ quiet: true });
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--external-db')) throw new Error('Use server:local [--external-db].');
const external = args.includes('--external-db');
const files = ['--file', 'compose.yaml', ...(!external ? ['--file', 'compose.postgres.yaml'] : []), ...(process.env.GOOGLE_APPLICATION_CREDENTIALS ? ['--file', 'compose.firebase-credentials.yaml'] : [])];
function compose(args: string[]) {
  const result = spawnSync('docker', ['compose', ...files, ...args], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Self-host setup stopped. Existing database and cache volumes were preserved.');
}
compose(['build', 'little-say']);
if (!external) compose(['up', '--detach', '--wait', 'postgres']);
compose(['run', '--rm', '--no-deps', 'little-say', 'node', 'server/database-cli.js', 'migrate']);
compose(['up', '--detach', '--no-build', '--wait', 'little-say']);
