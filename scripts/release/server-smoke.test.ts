/** @file Verifies the release smoke environment initializes auth without requiring a running Firebase emulator. */
import { expect, it, vi } from 'vitest';
import config from '../../release.config.json';
import { FirebaseIdentity } from '../../apps/server/src/accounts/firebase';

const { createUser } = vi.hoisted(() => ({ createUser: vi.fn().mockRejectedValue(new Error('No Auth emulator runs in the release smoke stack.')) }));
vi.mock('firebase-admin/auth', () => ({
  /** Reject provisioning so the test detects startup dependencies absent from the smoke stack. */
  getAuth: () => ({ createUser }),
}));

it('release smoke startup neither provisions nor advertises a development login', async () => {
  const environment = config.server.smoke.environment;
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', environment.FIREBASE_AUTH_EMULATOR_HOST);
  const identity = new FirebaseIdentity(environment);
  try {
    await identity.prepareDevelopmentAccount();
    expect(createUser).not.toHaveBeenCalled();
    expect(identity.config.developmentAccount).toBeUndefined();
  } finally {
    await identity.close();
    vi.unstubAllEnvs();
  }
});
