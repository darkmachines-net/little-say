/** @file Reconciles external operations after runner loss, preserving IDs and refusing ambiguous duplicate submissions. */

import { assert } from './common';
import type { Operation } from './contract';
import { reduceOperation, type OperationEvidence } from '../../tools/release-engine/index.mjs';

export interface OperationStore {
  /** Load the last durable state for this single-writer operation. */
  operation<T>(key: string): Operation<T> | undefined;
  /** Append state before advancing to another external side effect. */
  save<T>(state: Omit<Operation<T>, 'sequence' | 'schema'>): Operation<T>;
}
export interface Provider<T> {
  /** Find exact matching operations, including failed ones; return all matches to expose ambiguity. */
  find(): Promise<string[]>;
  /** Start or retry the prior verified failed ID and return its accepted provider ID. */
  start(previousId?: string): Promise<string>;
  /** Validate a provider-supported retry and return durable proof before recording another request intent. */
  prepareRetry?(id: string): Promise<OperationEvidence>;
  /** Read status without mutating it; terminal failures are explicit. */
  status(id: string): Promise<'running' | 'failed' | 'complete'>;
  /** Verify final identity and collect portable evidence. */
  verify(id: string): Promise<T>;
}

/** Recover an accepted provider ID without waiting for completion; ambiguous requests remain blocking. */
export async function acceptOperation<T>(store: OperationStore, key: string, provider: Provider<T>): Promise<Operation<T>> {
  let state = store.operation<T>(key);
  if (state?.status === 'complete') return state;
  let id = state?.status === 'running' ? state.ids.at(-1) : undefined;
  if (!id) {
    const found = (await provider.find()).filter(candidate => !state?.ids.includes(candidate));
    assert(found.length <= 1, `Multiple provider operations match ${key}; reconcile before retrying.`);
    if (found.length) id = found[0];
    else {
      assert(!state || state.status === 'failed', `Unknown outcome for ${key}. No second request was sent; reconcile the provider dashboard and journal.`);
      // Validate the new request boundary with the shared engine before persisting its intent.
      let intent = reduceOperation(null, { type: 'intent', operationKey: key });
      const previousId = state?.status === 'failed' ? state.ids.at(-1) : undefined;
      assert(state?.status !== 'failed' || !provider.prepareRetry || previousId, 'Failed provider operation has no original ID. Reconcile before retrying.');
      const retryProof = previousId && provider.prepareRetry ? await provider.prepareRetry(previousId) : undefined;
      if (retryProof) {
        const accepted = reduceOperation(intent, { type: 'accepted', operationId: previousId! });
        const retryEvent = { type: 'retry' as const, proof: retryProof };
        intent = reduceOperation(reduceOperation(accepted, { type: 'failed', definitive: true, reason: 'Provider verified an exact-request retry.', proof: retryProof }), retryEvent);
      }
      state = store.save({ key, status: 'intent', ids: state?.ids || [], ...(retryProof ? { retryProof } : {}) });
      id = await provider.start(previousId);
      reduceOperation(intent, { type: 'accepted', operationId: id });
    }
    state = store.save({ key, status: 'running', ids: [...(state?.ids || []), id], ...(state?.retryProof ? { retryProof: state.retryProof } : {}) });
  }
  return state!;
}

/** Recover or run one operation; unknown creation outcomes never authorize a second blind request. */
export async function runOperation<T>(store: OperationStore, key: string, provider: Provider<T>, options: { polls?: number; pause?: () => Promise<void> } = {}): Promise<T> {
  const state = await acceptOperation(store, key, provider);
  const id = state.ids.at(-1)!;
  if (state.status === 'complete') return provider.verify(id);
  for (let attempt = 0; attempt < (options.polls ?? 180); attempt++) {
    const status = await provider.status(id);
    if (status === 'failed') {
      store.save({ key, status: 'failed', ids: state!.ids });
      throw new Error(`${key} failed at provider ID ${id}. Rerun this workflow after inspecting the provider error.`);
    }
    if (status === 'complete') {
      const result = await provider.verify(id);
      store.save({ key, status: 'complete', ids: state!.ids, result }); return result;
    }
    await (options.pause || (() => new Promise<void>(resolve => setTimeout(resolve, 20000))))();
  }
  throw new Error(`${key} is still running at provider ID ${id}. Rerun this workflow to resume waiting.`);
}
