// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Records the cassette that cassette.test.ts replays offline: a full agent
 * run against a local Ollama qwen3:0.6b, through @taalcut/models and pi-ai.
 * Runs only with TAALCUT_RECORD=1 and Ollama up:
 *
 *   TAALCUT_RECORD=1 pnpm --filter @taalcut/agent exec vitest run test/ollama.record.test.ts
 */
import { unwrap } from '@taalcut/core';
import { cassetteModeFromEnv, openCassette } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { harness } from './support/harness';
import { CASSETTE, LOOP, MODULES, ollamaModels, ollamaReachable, REQUEST } from './support/local-model';

const recording = cassetteModeFromEnv() === 'record' && (await ollamaReachable());

describe.skipIf(!recording)('record: agent run on Ollama qwen3:0.6b', { timeout: 300_000 }, () => {
  it('runs to the end and saves the cassette', async () => {
    const cassette = openCassette({ path: CASSETTE, mode: 'record' });
    const { client } = ollamaModels(cassette.fetch);
    const h = harness({
      modules: MODULES,
      script: () => ({}),
      deps: { models: client },
      settings: { loop: LOOP },
    });
    const outcome = unwrap(await h.agent.run(REQUEST));
    await cassette.save();
    expect(['completed', 'failed']).toContain(outcome.status);
  });
});
