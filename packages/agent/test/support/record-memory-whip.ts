// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Records the cassette memory/memory-whip.test.ts replays offline (LRN1-MEM): the assembly asked twice of a live
 * Ollama qwen3.5:4b, without memory and then with "Never use whip transitions." recalled. Not a test (vitest runs
 * only *.test.ts); run it by hand with Ollama serving the model:
 *
 *   TAALCUT_OLLAMA_URL=http://127.0.0.1:11434/v1 pnpm --filter @taalcut/agent exec tsx test/support/record-memory-whip.ts
 */
import { unwrap } from '@taalcut/core';
import { openCassette } from '@taalcut/models';
import { harness, ofType } from './harness';
import {
  ASSEMBLE,
  assemblyModule,
  qwenModels,
  rememberedNoWhip,
  WHIP_CASSETTE,
  WHIP_LOOP,
} from './memory-model';

const cassette = openCassette({ path: WHIP_CASSETTE, mode: 'record' });
const { client } = qwenModels(cassette.fetch);

async function assemble(remember: boolean): Promise<string> {
  const h = harness({
    modules: [assemblyModule()],
    script: () => ({}),
    deps: { models: client, ...(remember ? { phase3: { memory: rememberedNoWhip() } } : {}) },
    settings: { loop: WHIP_LOOP },
  });
  const outcome = unwrap(await h.agent.run(ASSEMBLE));
  const events = await h.events(outcome.runId);
  const chosen = ofType(events, 'tool.requested')
    .filter((event) => event.payload.tool === 'assembly.assemble')
    .map((event) => JSON.stringify(event.payload.input));
  const failed = ofType(events, 'run.failed').map((event) => JSON.stringify(event.payload));
  return `${outcome.status}: ${chosen.join(', ') || 'no assembly'}${failed.length > 0 ? ` (${failed.join('; ')})` : ''}`;
}

const before = await assemble(false);
const after = await assemble(true);
await cassette.save();
process.stdout.write(`without memory: ${before}\nwith "Never use whip transitions.": ${after}\n`);
