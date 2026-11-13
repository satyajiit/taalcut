// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: Settings → Privacy lists memory among what a module sends while memory goes into its cloud prompts:
 * a module the agent's prompts go to, that leaves this Mac, with the cloud switch on. Settings → Memory says the
 * same from the same plans (memory-service.test.ts).
 */
import {
  createMemorySettingsStore,
  err,
  ok,
  TimeoutError,
  unwrap,
  type AsyncResult,
  type ModelModuleId,
} from '@taalcut/core';
import { createMemoryConsentStore, createPrivacyService, type PrivacyModulePlan } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

const PLANS: PrivacyModulePlan[] = [
  { module: 'agent', runsOn: 'both', providers: ['openai'], sends: ['messages', 'tool-results', 'prompts'] },
  { module: 'vision', runsOn: 'cloud', providers: ['google'], sends: ['frames', 'prompts'] },
  { module: 'music', runsOn: 'this-mac', providers: [], sends: [] },
  { module: 'voice', runsOn: 'off', providers: [], sends: [] },
];

function overview(cloudPrompts: () => AsyncResult<boolean>) {
  const service = createPrivacyService({
    settings: createMemorySettingsStore(),
    consents: createMemoryConsentStore(),
    cloudCalls: async () => ok([]),
    modules: () => PLANS,
    // The agent's own prompts and a skill's on the music module.
    memory: { cloudPrompts, modules: () => ['agent', 'music'] },
  });
  return service.overview();
}

const sends = (modules: readonly { module: ModelModuleId; sends: readonly string[] }[]) =>
  Object.fromEntries(modules.map((m) => [m.module, m.sends]));

describe('memory in Settings → Privacy (LRN1-MEM)', () => {
  it('lists memory for a prompt module that leaves this Mac while the cloud switch is on, and nowhere else', async () => {
    const on = unwrap(await overview(async () => ok(true)));
    expect(sends(on.modules)).toEqual({
      agent: ['messages', 'tool-results', 'prompts', 'memory'],
      vision: ['frames', 'prompts'],
      music: [],
      voice: [],
    });
    const off = unwrap(await overview(async () => ok(false)));
    expect(sends(off.modules)['agent']).toEqual(['messages', 'tool-results', 'prompts']);
  });

  it('a failing read of the switch is an error value, never a guess', async () => {
    const failed = await overview(async () => err(TimeoutError({ ms: 5_000 })));
    expect(failed).toMatchObject({ ok: false, error: { code: 'core.timeout' } });
  });
});
