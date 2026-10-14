/** @file Defines backend URL validation and precedence independently of platform globals. */

/** Trim trailing slashes and reject non-HTTP URLs, embedded credentials, queries, or fragments. */
export function normalizeBackendUrl(value: string) {
  const cleaned = value.trim().replace(/\/+$/, '');
  const parsed = new URL(cleaned);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter an HTTP or HTTPS server address without a password, query, or fragment.');
  return cleaned;
}

/**
 * Use a development build override or the built-in service origin. Legacy device addresses are ignored.
 */
export function resolveBackendUrl(_legacyAddress: string, developmentUrl: string, serviceOrigin?: string) {
  // A saved deployment address must never silently divert a local development session.
  if (developmentUrl.trim()) return normalizeBackendUrl(developmentUrl);
  if (serviceOrigin) return normalizeBackendUrl(serviceOrigin);
  throw new Error('Little Say’s service is not configured in this build. Please install an updated version.');
}
