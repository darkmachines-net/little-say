/** @file Runs shared PR/release source validation only, without release planning, credentials or publication. */
import { fail, isMain, npm, sourceEnvironment } from './common';

/** Run repository checks and all PostgreSQL/Auth contracts; test:services owns demo emulator startup and cleanup. */
export function validateReleaseSource(): void {
  const env = sourceEnvironment();
  npm(['run', 'check'], { env });
  npm(['run', 'test:services'], { env });
}

if (isMain(import.meta.url)) {
  try { validateReleaseSource(); } catch (error) { fail(error); }
}
