/** @file Runs issue-23 browser regressions on an isolated port; retained only as evidence. */
import base from '../playwright.config';
export default { ...base, testDir: '../tests/web', use: { ...base.use, baseURL: 'http://127.0.0.1:4593' }, webServer: { ...base.webServer, url: 'http://127.0.0.1:4593/api/health', env: { ...base.webServer.env, PORT: '4593', ALLOWED_ORIGINS: 'http://127.0.0.1:4593' } } };
