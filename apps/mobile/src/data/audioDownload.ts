/** @file Validates downloaded speech clips before they enter platform storage. */

/**
 * Fetch WAV bytes with a 30-second timeout; reject failed responses, unexpected content types, or
 * invalid size and container markers.
 */
export async function downloadAudio(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('Audio could not be downloaded.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 46 || bytes.length > 960044 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE') throw new Error('The downloaded audio was invalid.');
    return bytes;
  } finally { clearTimeout(timer); }
}
