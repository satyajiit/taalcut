// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Cassette mechanics: record against the mock server, scrub, replay offline, fail loudly on drift. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cassetteModeFromEnv,
  disableNetwork,
  openCassette,
  scrubSecrets,
  scrubUrl,
  type ChatMessage,
  type ModelChoice,
} from '@taalcut/models';
import { ANTHROPIC_KEY, createHarness, createOfflineClient, OPENAI_KEY } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Pick the hook shot.' }];
const OPENAI: ModelChoice = { provider: 'openai', model: 'gpt-5.4' };
const ANTHROPIC: ModelChoice = { provider: 'anthropic', model: 'claude-sonnet-5' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'taalcut-cassette-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('record then replay', () => {
  it('replays recorded OpenAI and Anthropic streams offline with identical results, and scrubs secrets', async () => {
    const path = join(dir, 'two-providers.json');
    const recorder = openCassette({ path, mode: 'record', secrets: [OPENAI_KEY, ANTHROPIC_KEY] });
    const live = await createHarness({ fetch: recorder.fetch });
    live.server.script('openai', {
      kind: 'reply',
      text: `Open on the wave. Key ${OPENAI_KEY} leaked`,
      reasoning: 'Wide first.',
    });
    live.server.script('anthropic', {
      kind: 'error',
      status: 429,
      message: 'slow down',
      headers: { 'retry-after': '3' },
    });
    const recordedOk = await live.client.complete({
      module: 'agent',
      target: { ...OPENAI, reasoning: 'low' },
      messages: PROMPT,
    });
    const recordedErr = await live.client.complete({ module: 'agent', target: ANTHROPIC, messages: PROMPT });
    await recorder.save();
    await live.close();

    const file = readFileSync(path, 'utf8');
    expect(file).not.toContain(OPENAI_KEY);
    expect(file).not.toContain(ANTHROPIC_KEY);
    expect(file).not.toMatch(/authorization|x-api-key/i);
    expect(file).toContain('[REDACTED]');
    const parsed = JSON.parse(file) as { interactions: { response: { chunks: string[]; status: number } }[] };
    expect(parsed.interactions.map((i) => i.response.status)).toEqual([200, 429]);
    expect(parsed.interactions[0]!.response.chunks.length).toBeGreaterThan(5);

    // The server is gone and the network is off: only the cassette can answer.
    const guard = disableNetwork();
    try {
      const player = openCassette({ path, mode: 'replay' });
      const offline = createOfflineClient(player.fetch);
      const replayedOk = await offline.client.complete({
        module: 'agent',
        target: { ...OPENAI, reasoning: 'low' },
        messages: PROMPT,
      });
      const replayedErr = await offline.client.complete({
        module: 'agent',
        target: ANTHROPIC,
        messages: PROMPT,
      });
      expect(replayedOk.ok && recordedOk.ok && replayedOk.value.text).toBe(
        recordedOk.ok ? recordedOk.value.text.replace(OPENAI_KEY, '[REDACTED]') : '',
      );
      expect(replayedOk.ok && replayedOk.value.usage).toEqual(recordedOk.ok && recordedOk.value.usage);
      expect(!replayedErr.ok && replayedErr.error).toMatchObject({
        code: 'models.rate_limited',
        params: { retryAfterMs: 3000 },
      });
      expect(!recordedErr.ok && recordedErr.error.code).toBe('models.rate_limited');
      expect(player.unused()).toBe(0);
      expect(guard.blocked).toEqual([]);
    } finally {
      guard.restore();
    }
  });

  it('fails loudly when a request no longer matches the recording', async () => {
    const path = join(dir, 'drift.json');
    const recorder = openCassette({ path, mode: 'record' });
    const live = await createHarness({ fetch: recorder.fetch });
    await live.client.complete({ module: 'agent', target: OPENAI, messages: PROMPT });
    await recorder.save();
    await live.close();

    const player = openCassette({ path, mode: 'replay' });
    const offline = createOfflineClient(player.fetch);
    const drifted = await offline.client.complete({
      module: 'agent',
      target: OPENAI,
      messages: [{ role: 'user', content: 'Something else' }],
    });
    expect(!drifted.ok && drifted.error.code).toBe('models.bad_request');
    expect(!drifted.ok && drifted.error.detail).toMatch(/no recorded response.*TAALCUT_RECORD=1/);
    expect(player.misses()).toHaveLength(1);
    // Key order and volatile fields don't count as drift.
    const same = await offline.client.complete({
      module: 'agent',
      target: OPENAI,
      messages: PROMPT,
      sessionId: 'another-session',
    });
    expect(same.ok).toBe(true);
  });

  it('needs the fixture to exist in replay mode, and TAALCUT_RECORD=1 switches to record mode', () => {
    expect(() => openCassette({ path: join(dir, 'missing.json'), mode: 'replay' })).toThrow(
      /TAALCUT_RECORD=1/,
    );
    expect(cassetteModeFromEnv({ TAALCUT_RECORD: '1' })).toBe('record');
    expect(cassetteModeFromEnv({})).toBe('replay');
  });

  it('honours an abort signal during replay', async () => {
    const path = join(dir, 'abort.json');
    const recorder = openCassette({ path, mode: 'record' });
    const live = await createHarness({ fetch: recorder.fetch });
    await live.client.complete({ module: 'agent', target: OPENAI, messages: PROMPT });
    await recorder.save();
    await live.close();
    const offline = createOfflineClient(openCassette({ path, mode: 'replay' }).fetch);
    const controller = new AbortController();
    controller.abort();
    const result = await offline.client.complete({
      module: 'agent',
      target: OPENAI,
      messages: PROMPT,
      signal: controller.signal,
    });
    expect(!result.ok && result.error.code).toBe('core.cancelled');
  });
});

describe('secret scrubbing', () => {
  it('removes known secrets and common key and token shapes', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';
    const text = [
      'Authorization: Bearer abcdefghijklmnop12345',
      'key sk-proj-ABCDEFGHIJKLMNOPQRSTUV',
      'google AIzaSyA1234567890abcdefghijklmnopqrstu',
      `token ${jwt}`,
      '{"refresh_token":"rt-1","api_key":"whatever"}',
      'custom my-very-own-secret-value',
    ].join('\n');
    const out = scrubSecrets(text, ['my-very-own-secret-value', 'short']);
    expect(out).toContain('Bearer [REDACTED]');
    for (const leaked of [
      'abcdefghijklmnop12345',
      'sk-proj-',
      'AIzaSy',
      jwt,
      'rt-1',
      'whatever',
      'my-very-own',
    ]) {
      expect(out).not.toContain(leaked);
    }
    expect(scrubUrl('https://user:pw@example.com/v1?key=abc&alt=sse')).toBe(
      'https://example.com/v1?key=%5BREDACTED%5D&alt=sse',
    );
  });

  it('removes credentials from URLs under any common parameter name, and token shapes under others', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2ln';
    for (const [url, secret] of [
      ['https://gpu.example/v1?api-key=sk-thisisasecretkey1234567890', 'sk-thisisasecretkey'],
      ['https://gpu.example/v1?client_secret=supersecretvalue1', 'supersecretvalue1'],
      [`https://gpu.example/v1?id_token=${jwt}`, jwt],
      ['https://gpu.example/v1?X-Api-Key=plainvalue123&alt=sse', 'plainvalue123'],
      [`https://gpu.example/cb?state=${jwt}`, jwt],
    ] as const) {
      const scrubbed = scrubUrl(url);
      expect(scrubbed, url).not.toContain(secret);
      expect(scrubbed, url).toContain('REDACTED');
    }
    // The same names in free text, e.g. a URL quoted in an error message.
    expect(scrubSecrets('HTTP 401 from http://h/v1?client_secret=supersecretvalue1&x=1')).toBe(
      'HTTP 401 from http://h/v1?client_secret=[REDACTED]&x=1',
    );
  });

  it("removes Taalcut's MCP bearer, whole or cut short (SB-26)", () => {
    const bearer = `tcm_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v'}`;
    expect(bearer).toHaveLength(47);
    expect(scrubSecrets(`token ${bearer} in a line`)).toBe('token [REDACTED] in a line');
    expect(scrubSecrets(`cut ${bearer.slice(0, 30)}…`)).toBe('cut [REDACTED]…');
    expect(scrubSecrets('the tcm_ prefix alone, tcm_short')).toBe('the tcm_ prefix alone, tcm_short');
  });
});
