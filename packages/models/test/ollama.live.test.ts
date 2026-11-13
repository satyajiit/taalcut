// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Live test against a local Ollama with qwen3:0.6b, through pi-ai's
 * OpenAI-compatible path. Skipped when Ollama isn't reachable, so CI stays
 * offline. Optional integration only: Ollama is never a default or a
 * dependency (D16), just a server a user may bring under Advanced. With TAALCUT_RECORD=1 it records the cassettes that
 * replay.test.ts plays back offline.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cassetteModeFromEnv,
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  discoverLocalModels,
  OLLAMA_DEFAULT_BASE_URL,
  openCassette,
  type Cassette,
} from '@taalcut/models';
import { createHarness } from './support/harness';
import {
  askHook,
  askHookThinking,
  CASSETTE_DIR,
  OLLAMA,
  OLLAMA_ENDPOINT,
  ollamaClient,
  ollamaReachable,
  runToolLoop,
} from './support/scenarios';

const available = await ollamaReachable();
const recording = cassetteModeFromEnv() === 'record';

function client(name: string): ReturnType<typeof ollamaClient> & { cassette?: Cassette } {
  if (!recording) return ollamaClient();
  const cassette = openCassette({ path: join(CASSETTE_DIR, `${name}.json`), mode: 'record' });
  return { ...ollamaClient(cassette.fetch), cassette };
}

describe.skipIf(!available)('live: Ollama qwen3:0.6b through pi-ai', { timeout: 180_000 }, () => {
  it('runs the same prompt on Ollama and on a cloud-style provider through one interface, with tokens and cost', async () => {
    const h = await createHarness({ endpoints: [OLLAMA_ENDPOINT] });
    try {
      const local = await askHook(h.client, OLLAMA);
      const cloud = await askHook(h.client, { provider: 'openai', model: 'gpt-5.4' });
      if (!local.ok) throw new Error(`${local.error.code}: ${local.error.detail}`);
      if (!cloud.ok) throw new Error(cloud.error.code);
      expect(local.value.text.length).toBeGreaterThan(5);
      expect(local.value.usage.inputTokens).toBeGreaterThan(0);
      expect(local.value.usage.outputTokens).toBeGreaterThan(0);
      // Local inference has no per-token price; the cloud call is priced from pi-ai's metadata.
      expect(local.value.usage.costUsd).toBe(0);
      expect(cloud.value.usage.costUsd).toBeGreaterThan(0);
      expect(h.callLog.records.map((r) => [r.provider, r.local, r.outcome])).toEqual([
        ['ollama', true, 'ok'],
        ['openai', false, 'ok'],
      ]);
    } finally {
      await h.close();
    }
  });

  it('answers a plain question', async () => {
    const { client: c, callLog, cassette } = client('ollama-hook');
    const result = await askHook(c, OLLAMA);
    await cassette?.save();
    expect(result.ok && result.value.text.length).toBeGreaterThan(5);
    expect(callLog.records[0]).toMatchObject({ provider: 'ollama', local: true, outcome: 'ok', costUsd: 0 });
  });

  it('thinks first when reasoning is on', async () => {
    const { client: c, cassette } = client('ollama-hook-thinking');
    const result = await askHookThinking(c, OLLAMA);
    await cassette?.save();
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.reasoning).toBe('low');
    expect(result.value.message.parts.some((p) => p.type === 'reasoning' && p.text.length > 0)).toBe(true);
  });

  it('discovers the pulled model and its capabilities, and answers through the discovered endpoint', async () => {
    const found = await discoverLocalModels({ baseUrl: OLLAMA_DEFAULT_BASE_URL, kind: 'ollama' });
    if (!found.ok) throw new Error(found.error.code);
    expect(found.value).toContainEqual(
      expect.objectContaining({ id: OLLAMA.model, reasoning: true, vision: false, contextWindow: 40960 }),
    );
    const listed = await discoverLocalModels({ baseUrl: OLLAMA_DEFAULT_BASE_URL, kind: 'openai-compatible' });
    expect(listed.ok && listed.value.map((m) => m.id)).toContain(OLLAMA.model);

    const runtime = createModelRuntime();
    const added = runtime.setEndpoint({
      id: 'ollama',
      name: 'Ollama',
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      models: found.value,
    });
    expect(added.ok).toBe(true);
    const c = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
    });
    const result = await askHook(c, OLLAMA);
    expect(result.ok && result.value.local).toBe(true);
  });

  it('calls a tool, reads the result and answers', async () => {
    const { client: c, callLog, cassette } = client('ollama-tool-loop');
    const outcome = await runToolLoop(c, OLLAMA);
    await cassette?.save();
    expect(outcome.first.stopReason).toBe('tool_use');
    expect(outcome.query.toLowerCase()).toContain('beach');
    expect(outcome.final.text.length).toBeGreaterThan(0);
    expect(callLog.records).toHaveLength(2);
  });
});
