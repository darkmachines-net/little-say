/** @file Keeps Expo's default bundler configuration and adds the optional self-hosted development API proxy. */

const { getDefaultConfig } = require('expo/metro-config');
const { createDevelopmentApiProxy } = require('../../scripts/dev-proxy.cjs');

const config = getDefaultConfig(__dirname);
if (process.env.NODE_ENV === 'development' && process.env.LITTLE_SAY_DEV_PROXY_URL && process.env.EXPO_PUBLIC_WEB_API_URL) {
  const web = new URL(process.env.EXPO_PUBLIC_WEB_API_URL);
  const proxy = createDevelopmentApiProxy(process.env.LITTLE_SAY_DEV_PROXY_URL, [web.origin, `http://localhost:${web.port}`, `http://127.0.0.1:${web.port}`]);
  const enhance = config.server.enhanceMiddleware;
  /** Handle the fixed remote API first, then preserve Expo's middleware for bundles and development tools. */
  config.server.enhanceMiddleware = (middleware, server) => {
    const next = enhance ? enhance(middleware, server) : middleware;
    return (request, response, done) => proxy(request, response, () => next(request, response, done));
  };
}

module.exports = config;
