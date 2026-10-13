/** @file Verifies backend address validation and development override precedence. */

import { describe, expect, it } from 'vitest';
import { resolveBackendUrl } from './backendConfig';

describe('backend URL selection', () => {
  it('uses the development launcher URL even when an old deployment URL is saved', () => {
    expect(resolveBackendUrl('https://old.example', 'http://192.168.1.20:8788/', 'http://localhost:8081')).toBe('http://192.168.1.20:8788');
  });
  it('ignores legacy device overrides in managed builds and keeps same-origin web behavior', () => {
    expect(resolveBackendUrl(' https://private.example/ ', '', 'https://web.example')).toBe('https://web.example');
    expect(resolveBackendUrl('javascript:old-setting', '', 'https://native.example/')).toBe('https://native.example');
    expect(resolveBackendUrl('', '', 'https://web.example')).toBe('https://web.example');
    expect(() => resolveBackendUrl('https://old.example', '')).toThrow('not configured in this build');
  });
  it('rejects unsafe schemes, embedded credentials, and malformed URL configuration', () => {
    for (const url of ['javascript:alert(1)', 'https://user:password@example.com', 'https://example.com?key=secret', 'http://example.com#part']) expect(() => resolveBackendUrl('', url)).toThrow();
  });
});
