export function normalizeBackendUrl(value: string) {
  const cleaned = value.trim().replace(/\/+$/, '');
  const parsed = new URL(cleaned);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter an HTTP or HTTPS server address without a password, query, or fragment.');
  return cleaned;
}

export function resolveBackendUrl(configured: string, developmentUrl: string, webOrigin?: string) {
  // A saved deployment address must never silently divert a local development session.
  if (developmentUrl.trim()) return normalizeBackendUrl(developmentUrl);
  if (configured.trim()) return normalizeBackendUrl(configured);
  if (webOrigin) return webOrigin;
  throw new Error('Add your private server address in Parent settings to use AI. For local development, start the app with npm run dev.');
}
