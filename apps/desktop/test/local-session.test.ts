// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Local only journey's on-device session (P3-B10): the production ModelClient, with Local only on and
 * the Local only profile's chain, reaches the embedded runtime's 'on-device' endpoint over loopback, where
 * the llama-server stand-in answers in its Chat Completions format; and nothing else connects.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { referenceAsk } from '@taalcut/gate-demo';
import {
  BUILTIN_PROFILES,
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
} from '@taalcut/models';
import { recordNetwork } from '@taalcut/models/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { anthropicView } from '../src/utility/roots/agent-local-standin';
import { standInLocalRuntime } from '../src/utility/roots/agent-local-session';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HIGH = {
  tier: 'high',
  compute: { backends: ['metal', 'cpu'], gpuMemoryBytes: 64 * 2 ** 30, neuralEngine: true },
} as const;
const LOCAL_ONLY = BUILTIN_PROFILES.find((p) => p.id === 'local-only');

describe('the on-device stand-in session', () => {
  it('answers the make flow over loopback through the production client, with Local only on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-local-session-'));
    dirs.push(dir);
    const runtime = createModelRuntime({ builtinProviders: ['openai', 'anthropic', 'google'] });
    const slot = standInLocalRuntime(dir)(runtime);
    slot.start(HIGH);
    await expect
      .poll(() => existsSync(join(dir, 'runtime.json')), { timeout: 5_000, interval: 20 })
      .toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8'))).toMatchObject({ tier: 'high' });

    const callLog = createMemoryCloudCallSink();
    const client = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider({}),
      callLog,
      selector: { resolve: (module) => ok({ module, choices: LOCAL_ONLY?.modules[module].chain ?? [] }) },
      localLease: (provider, signal) => slot.localLease(provider, signal),
      localOnly: () => true,
      retry: { maxRetries: 0 },
    });
    const network = recordNetwork();
    try {
      const reel = '/Users/demo/Desktop/trip-reel.mp4';
      const result = await client.complete({
        module: 'agent',
        system: 'You are Taalcut.',
        messages: [{ role: 'user', content: referenceAsk(reel) }],
        tools: [
          {
            name: 'startFlow',
            description: 'Starts a flow.',
            parameters: z.looseObject({}),
          },
        ],
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value).toMatchObject({
        provider: 'on-device',
        model: 'qwen3.5-4b',
        local: true,
        toolCalls: [
          { name: 'startFlow', arguments: { path: 'reference', reference: { kind: 'file', path: reel } } },
        ],
      });
      expect(network.blocked()).toEqual([]);
      expect(network.attempts.every((a) => a.host === '127.0.0.1')).toBe(true);
    } finally {
      network.restore();
      await slot.dispose();
    }
    expect(callLog.records.map((r) => [r.module, r.provider, r.local])).toEqual([
      ['agent', 'on-device', true],
    ]);
    const turns = readFileSync(join(dir, 'turns.jsonl'), 'utf8').trim().split('\n');
    expect(turns.map((line) => JSON.parse(line).kind)).toEqual(['agent']);
  });

  it('reads a Chat Completions conversation the way the script reads requests', () => {
    const view = anthropicView({
      model: 'qwen3.5-4b',
      messages: [
        { role: 'system', content: 'soul\n# Skill: templates.analyst' },
        { role: 'user', content: [{ type: 'text', text: 'Make a video like this reel: /x.mp4' }] },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', function: { name: 'templates_breakdown', arguments: '{"a":1}' } }],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      ],
      tools: [{ function: { name: 'templates_breakdown' } }],
    });
    expect(view).toEqual({
      model: 'qwen3.5-4b',
      system: 'soul\n# Skill: templates.analyst',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Make a video like this reel: /x.mp4' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'c1', name: 'templates_breakdown', input: { a: 1 } }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' }] },
      ],
      tools: [{ name: 'templates_breakdown' }],
    });
  });
});
