/** @file Downloads bounded PNG assets from the configured backend and verifies their content-addressed identity. */

import * as Crypto from 'expo-crypto';
import { pictureAssetIdSchema } from '@little-say/core';

/** Download and hash a PNG before it becomes a durable local board asset; abort leaves existing assets intact. */
export async function downloadPicture(id: string, url: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  pictureAssetIdSchema.parse(id);
  const response = await fetch(url, { signal });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png' || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Picture download failed.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024 || bytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) throw new Error('Invalid picture data.');
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== id) throw new Error('Picture download was incomplete. Try again.');
  return bytes;
}
