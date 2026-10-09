/** @file Runs the maintained preparation tests against a local export without provider services. */
export default { testDir: '../little-say/tests/web', testMatch: 'accounts.spec.ts', workers: 1, timeout: 45000, expect: { timeout: 8000 }, use: { baseURL: 'http://127.0.0.1:4276', browserName: 'chromium', channel: 'chrome', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' } };
