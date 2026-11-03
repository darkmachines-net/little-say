/** @file Recovers transient JSON read failures within a caller-owned deadline and normalizes native transport errors. */

class TransportError extends TypeError {}

function transportFailure(error: unknown): never {
  throw new TransportError('Little Say network request failed.', { cause: error });
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

/**
 * Fetch and decode JSON, retrying GET transport failures twice after 500 ms and 1 second.
 * Expo native FetchErrors extend Error rather than TypeError; normalize them and browser fetch
 * failures to TypeErrors with the original cause, regardless of platform-specific message text.
 * The caller's signal covers every attempt and delay; mutations, HTTP responses, and invalid JSON
 * are never replayed. Callers remain responsible for HTTP status handling and schema validation.
 */
export async function requestJson(url: string, init: RequestInit & { signal: AbortSignal }) {
  const retries = (init.method ?? 'GET').toUpperCase() === 'GET' ? 2 : 0;
  for (let attempt = 0; ; attempt++) {
    init.signal.throwIfAborted();
    try {
      const response = await fetch(url, init).catch(transportFailure);
      const data = await response.json().catch((error: unknown) => {
        if (error instanceof SyntaxError) throw new Error('Little Say’s service returned an unexpected response. Please try again.', { cause: error });
        transportFailure(error);
      });
      return { response, data };
    } catch (error) {
      if (!(error instanceof TransportError) || init.signal.aborted || attempt >= retries) throw error;
      await pause(500 * 2 ** attempt, init.signal);
    }
  }
}
