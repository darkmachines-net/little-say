/** @file Isolated port configuration for issue 28 investigation; not product source. */
import base from '../../playwright.config';
export default { ...base, testDir: '../../tests/web', outputDir: './results', use: { ...base.use, channel: 'chrome', baseURL: 'http://127.0.0.1:4188' }, webServer: { ...base.webServer, url: 'http://127.0.0.1:4188/api/health', env: { ...base.webServer.env, PORT: '4188', ALLOWED_ORIGINS: 'http://127.0.0.1:4188' } } };

