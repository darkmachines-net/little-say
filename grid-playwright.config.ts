/** @file Runs the maintained browser suite on this task's reserved loopback port. */
import config from '../playwright.config';
export default { ...config, testDir: '../tests/web', outputDir: '../test-results', use: { ...config.use, channel: 'msedge', baseURL: 'http://127.0.0.1:7411' }, webServer: { ...config.webServer, url: 'http://127.0.0.1:7411/api/health', env: { ...config.webServer.env, PORT: '7411', ALLOWED_ORIGINS: 'http://127.0.0.1:7411' } } };

