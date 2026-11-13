// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-I3 (agent half): a full agent run on the real @taalcut/models client,
 * replayed from an HTTP cassette recorded on Ollama qwen3:0.6b (see
 * ollama.record.test.ts), with the network disabled. pi-ai's own request
 * building, SSE parsing and tool-call parsing run on the recorded bytes, and
 * the agent's requests must match the recording byte for byte.
 */
import { unwrap } from '@taalcut/core';
import { openCassette } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { harness, ofType, types } from './support/harness';
import { CASSETTE, LOOP, MODULES, ollamaModels, REQUEST } from './support/local-model';

describe('an agent run replayed from recorded model traffic', () => {
  it('plans through a real tool call, acts and completes, offline', async () => {
    const cassette = openCassette({ path: CASSETTE, mode: 'replay' });
    const { client, callLog } = ollamaModels(cassette.fetch);
    const h = harness({
      modules: MODULES,
      script: () => ({}),
      deps: { models: client },
      settings: { loop: LOOP },
    });
    const outcome = unwrap(await h.agent.run(REQUEST));

    expect(outcome.status).toBe('completed');
    expect(cassette.unused()).toBe(0);
    expect(cassette.misses()).toEqual([]);
    const events = await h.events(outcome.runId);
    expect(types(events).filter((t) => t.startsWith('model.'))).toEqual([
      'model.requested',
      'model.responded',
      'model.requested',
      'model.responded',
      'model.requested',
      'model.responded',
    ]);
    // The plan came from the model's own updatePlan call, parsed by pi-ai from the recorded stream.
    expect(ofType(events, 'plan.created')[0]?.payload.steps).toEqual([{ id: 's1', text: 'Count the words' }]);
    const responded = ofType(events, 'model.responded');
    expect(responded.map((e) => [e.payload.provider, e.payload.model, e.payload.local])).toEqual([
      ['ollama', 'qwen3:0.6b', true],
      ['ollama', 'qwen3:0.6b', true],
      ['ollama', 'qwen3:0.6b', true],
    ]);
    const usage = responded[0]!.payload.usage;
    expect(usage.inputTokens + usage.cachedInputTokens).toBeGreaterThan(1000);
    expect(callLog.records.map((r) => r.outcome)).toEqual(['ok', 'ok', 'ok']);
    // What the recording shows (re-recorded with SOUL.md v1, 2026-10-14): this 0.6B model planned, called the
    // word counter and answered from its result. (With SOUL.md v0 it answered without calling the tool.)
    expect(ofType(events, 'tool.requested').map((e) => e.payload.tool)).toEqual([
      'updatePlan',
      'clips.countWords',
    ]);
    expect(ofType(events, 'tool.completed')[1]?.payload.output).toEqual({
      kind: 'inline',
      value: { words: 5 },
    });
    expect(outcome.report).toContain('5 words');

    // And exact replay from the agent's own log agrees with it.
    const replay = unwrap(await h.agent.replay(outcome.runId));
    expect(replay).toMatchObject({ modelTurns: 3, promptDrift: 0, status: 'completed' });
  });
});
