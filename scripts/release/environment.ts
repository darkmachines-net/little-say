import { createHash } from 'node:crypto';
import { assert, safeEnvironment } from './common';
import type { Profile } from './native-contract';

export function releaseEnvironment(profile: Profile) {
  return { ...safeEnvironment(), EXPO_NO_DOTENV: '1', LITTLE_SAY_CHANNEL: profile, CI: '1' };
}
export function validateExpoEnvironment(profile: Profile, variables: { name: string; value: string; visibility: string; type: string }[]) {
  const values: Record<string, string> = {};
  for (const variable of variables) {
    assert(variable.visibility !== 'SECRET' && variable.type === 'STRING' && typeof variable.value === 'string', `EAS variable ${variable.name} cannot be reproduced locally. Use readable string values for native releases; keep backend secrets on the server.`);
    assert(!/^(EXPO_PUBLIC_|AAC_OPENAI_KEY$|OPENAI_API_KEY$|NODE_OPTIONS$|EXPO_NO_DOTENV$|EAS_BUILD_)/i.test(variable.name), `Remove ${variable.name} from the EAS environment. Release configuration is owned by native-release.json; OpenAI keys belong on the server.`);
    assert(variable.name !== 'LITTLE_SAY_CHANNEL' || variable.value === profile, 'EAS environment points to a different update channel.');
    values[variable.name] = variable.value;
  }
  const hash = createHash('sha256').update(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { env: { ...releaseEnvironment(profile), ...values, LITTLE_SAY_CHANNEL: profile }, hash };
}
