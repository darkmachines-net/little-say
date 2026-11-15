/** @file Defines and validates hosted board admission and service capacity defaults. */

const settings = {
  accountBoardStartsPerMinute: ['AAC_AI_ACCOUNT_BOARD_STARTS_PER_MINUTE', 2, 120],
  accountBoardOutstanding: ['AAC_AI_ACCOUNT_BOARD_OUTSTANDING', 2, 24],
  accountBoardConcurrency: ['AAC_AI_ACCOUNT_BOARD_CONCURRENCY', 1, 8],
  accountJobStartsPerMinute: ['AAC_AI_ACCOUNT_JOB_STARTS_PER_MINUTE', 30, 240],
  accountJobOutstanding: ['AAC_AI_ACCOUNT_JOB_OUTSTANDING', 2, 24],
  serviceForegroundConcurrency: ['AAC_AI_SERVICE_FOREGROUND_CONCURRENCY', 8, 16],
  serviceSpeechConcurrency: ['AAC_AI_SERVICE_SPEECH_CONCURRENCY', 4, 8],
  accountImageConcurrency: ['AAC_AI_ACCOUNT_IMAGE_CONCURRENCY', 9, 24],
  serviceImageConcurrency: ['AAC_AI_SERVICE_IMAGE_CONCURRENCY', 50, 100],
} as const;

export type AiLimits = Readonly<Record<keyof typeof settings, number>>;
export const AI_CLAIM_EXPIRY_SECONDS = 90;

/** Read positive integer limits from server settings and reject invalid bounds or inconsistent board capacity. */
export function readAiLimits(env: NodeJS.ProcessEnv): AiLimits {
  const limits = Object.fromEntries(Object.entries(settings).map(([key, [name, fallback, maximum]]) => {
    const raw = env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be a whole number from 1 to ${maximum}.`);
    }
    return [key, value];
  })) as AiLimits;
  if (limits.accountBoardConcurrency > limits.accountBoardOutstanding) {
    throw new Error('AAC_AI_ACCOUNT_BOARD_CONCURRENCY cannot exceed AAC_AI_ACCOUNT_BOARD_OUTSTANDING.');
  }
  return limits;
}
