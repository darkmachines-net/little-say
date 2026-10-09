/** @file Runs shared PR/release source validation only, without release planning, credentials or publication. */
import { fail, isMain, npm } from './common';

/** Run repository checks and all PostgreSQL/Auth contracts; test:services owns demo emulator startup and cleanup. */
export function validateReleaseSource(): void {
  npm(['run', 'check']);
  npm(['run', 'test:services']);
}

if (isMain(import.meta.url)) {
  try { validateReleaseSource(); } catch (error) { fail(error); }
}
