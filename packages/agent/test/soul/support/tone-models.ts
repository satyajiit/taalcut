// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Re-recording the tone session (SPEC section 22). With TAALCUT_RECORD=1 and the four keys in the
 * environment, the real authors (Balanced's OpenAI, Anthropic and Google models) answer the frozen set and xAI
 * judges, through the real @taalcut/models client: about US$5. Without the keys it records the stand-ins
 * again, so the committed file always answers the current SOUL.md and prompt set.
 *
 *   TAALCUT_RECORD=1 OPENAI_API_KEY=… ANTHROPIC_API_KEY=… GEMINI_API_KEY=… XAI_API_KEY=… \
 *     pnpm --filter @taalcut/agent exec vitest run test/soul/tone-recording.test.ts
 */
import { writeFileSync } from 'node:fs';
import {
  runToneSession,
  TONE_AUTHORS,
  TONE_JUDGE,
  TONE_RECORDING_PATH,
  type Soul,
  type TonePrompt,
} from '@taalcut/agent';
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  type ModelClient,
} from '@taalcut/models';
import { STAND_IN_AUTHORS, STAND_IN_JUDGE, standInToneModels } from './tone-stand-in';

const KEYS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
};

/** The real providers' client, when every key is set. */
export function realToneModels(env: NodeJS.ProcessEnv): ModelClient | undefined {
  const entries = Object.entries(KEYS).map(([provider, name]) => [provider, env[name]] as const);
  if (entries.some(([, secret]) => !secret)) return undefined;
  const credentials = Object.fromEntries(
    entries.map(([provider, secret]) => [
      provider,
      { kind: 'api_key' as const, secret: secret ?? '', source: 'env' },
    ]),
  );
  return createModelClient({
    runtime: createModelRuntime(),
    credentials: createStaticCredentialProvider(credentials),
    callLog: createMemoryCloudCallSink(),
  });
}

/** Records the session (real when the keys are there) and writes it where the report reads it. */
export async function recordToneSession(input: {
  readonly soul: Soul;
  readonly prompts: readonly TonePrompt[];
  readonly promptSetSha256: string;
  readonly today: string;
}): Promise<void> {
  const real = realToneModels(process.env);
  const recording = await runToneSession({
    ...input,
    models: real ?? standInToneModels(input.prompts),
    authors: real ? TONE_AUTHORS : STAND_IN_AUTHORS,
    judge: real ? TONE_JUDGE : STAND_IN_JUDGE,
    standIn: !real,
  });
  if (!recording.ok) throw new Error(`The tone session didn't record: ${recording.error.code}`);
  writeFileSync(TONE_RECORDING_PATH, `${JSON.stringify(recording.value, null, 2)}\n`);
}
