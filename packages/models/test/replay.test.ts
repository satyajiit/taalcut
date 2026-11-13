// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-I3 acceptance: agent-style model calls replay from recorded fixtures with
 * the network disabled. The cassettes were recorded from a real local model
 * (Ollama qwen3:0.6b) by ollama.live.test.ts with TAALCUT_RECORD=1; replay runs
 * pi-ai's real Chat Completions parsing, usage and cost code on those bytes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disableNetwork, NetworkDisabledError, openCassette, type NetworkGuard } from '@taalcut/models';
import {
  askGeminiText,
  askGeminiVision,
  askHook,
  askHookThinking,
  CASSETTE_DIR,
  GEMINI_KEY,
  geminiClient,
  OLLAMA,
  ollamaClient,
  runToolLoop,
} from './support/scenarios';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => {
  guard.restore();
});

const replay = (name: string) => openCassette({ path: join(CASSETTE_DIR, `${name}.json`), mode: 'replay' });

/** The only connections allowed to be attempted are the two the first test makes on purpose. */
const DELIBERATE_ATTEMPTS = ['fetch https://api.openai.com/v1/models', 'tcp api.anthropic.com:443'];

describe('offline replay of recorded model traffic', () => {
  it('really has no network', async () => {
    await expect(fetch('https://api.openai.com/v1/models')).rejects.toBeInstanceOf(NetworkDisabledError);
    const { connect } = await import('node:net');
    expect(() => connect(443, 'api.anthropic.com')).toThrow(NetworkDisabledError);
    expect(guard.blocked).toEqual(DELIBERATE_ATTEMPTS);
  });

  it('replays a plain answer with usage and the cloud-call record', async () => {
    const cassette = replay('ollama-hook');
    const { client, callLog } = ollamaClient(cassette.fetch);
    const result = await askHook(client, OLLAMA);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
    expect(result.value.text.length).toBeGreaterThan(5);
    expect(result.value.usage.inputTokens + result.value.usage.cachedInputTokens).toBeGreaterThan(0);
    expect(result.value.usage.outputTokens).toBeGreaterThan(0);
    expect(callLog.records).toHaveLength(1);
    expect(callLog.records[0]).toMatchObject({
      provider: 'ollama',
      model: 'qwen3:0.6b',
      local: true,
      outcome: 'ok',
    });
    expect(callLog.records[0]?.bytesReceived).toBeGreaterThan(0);
    expect(cassette.unused()).toBe(0);
  });

  it('replays reasoning deltas', async () => {
    const cassette = replay('ollama-hook-thinking');
    const { client } = ollamaClient(cassette.fetch);
    const result = await askHookThinking(client, OLLAMA);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.message.parts[0]?.type).toBe('reasoning');
    expect(cassette.unused()).toBe(0);
  });

  it('replays a two-turn tool loop', async () => {
    const cassette = replay('ollama-tool-loop');
    const { client, callLog } = ollamaClient(cassette.fetch);
    const outcome = await runToolLoop(client, OLLAMA);
    expect(outcome.first.stopReason).toBe('tool_use');
    expect(outcome.query.toLowerCase()).toContain('beach');
    expect(outcome.final.stopReason).toBe('stop');
    expect(outcome.final.text.length).toBeGreaterThan(0);
    expect(callLog.records.map((r) => r.outcome)).toEqual(['ok', 'ok']);
    expect(cassette.unused()).toBe(0);
  });

  it.each([
    ['google-gemini-text', askGeminiText, 'Cut on the downbeat.'],
    ['google-gemini-vision', askGeminiVision, 'A red square on white.'],
  ] as const)('replays %s through our fetch, with its cloud-call record', async (name, ask, text) => {
    const cassette = replay(name);
    const { client, callLog } = geminiClient(cassette.fetch);
    const result = await ask(client);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
    expect(result.value).toMatchObject({ provider: 'google', model: 'gemini-3.5-flash', text, local: false });
    expect(callLog.records).toEqual([
      expect.objectContaining({ provider: 'google', outcome: 'ok', inputTokens: 1290, outputTokens: 9 }),
    ]);
    expect(callLog.records[0]?.costUsd).toBeGreaterThan(0);
    expect(callLog.records[0]?.bytesReceived).toBeGreaterThan(0);
    expect(cassette.misses()).toEqual([]);
    expect(cassette.unused()).toBe(0);
  });

  it('nothing else tried to reach the network', () => {
    expect(guard.blocked).toEqual(DELIBERATE_ATTEMPTS);
  });

  it('keeps fixtures free of credentials', () => {
    const names = ['ollama-hook', 'ollama-hook-thinking', 'ollama-tool-loop'];
    for (const name of [...names, 'google-gemini-text', 'google-gemini-vision']) {
      const text = readFileSync(join(CASSETTE_DIR, `${name}.json`), 'utf8');
      expect(text).not.toMatch(/authorization|x-api-key|x-goog-api-key|Bearer\s+(?!\[REDACTED\])/i);
      expect(text).not.toContain('local-no-key');
      expect(text).not.toContain(GEMINI_KEY);
    }
  });
});
