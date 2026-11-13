// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineError, err, isId, newId, ok, unwrap, type ToolContextBase } from '@taalcut/core';
import { createMemoryArtifactStore, toolInputHash } from '@taalcut/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fakeServices, fxModule, fxTool, setup } from './helpers';

const Flaky = defineError('fx.flaky', { retryable: false });

describe('execute: the happy path', () => {
  it('validates, runs and returns a typed result with metadata', async () => {
    const { executor, events } = setup();
    const runId = newId<'AgentRun'>();
    const result = unwrap(
      await executor.execute('testdomain.countWords', { text: 'one two three' }, { runId }),
    );
    expect(result).toMatchObject({
      tool: 'testdomain.countWords',
      version: '1.0.0',
      inputHash: toolInputHash(
        { name: 'testdomain.countWords', version: '1.0.0' },
        { text: 'one two three' },
      ),
      value: { words: 3 },
      output: { kind: 'inline', value: { words: 3 } },
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
      cached: false,
      deduplicated: false,
      attempts: 1,
    });
    expect(isId(result.callId)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.finished']);
    expect(events[1]).toMatchObject({ callId: result.callId, runId, attempts: 1, cached: false });
    expect(events[1]).not.toHaveProperty('error');
  });

  it('accepts provider-safe call names and keeps a given callId', async () => {
    const { executor } = setup();
    const callId = newId<'ToolRun'>();
    const result = unwrap(await executor.execute('testdomain_countWords', { text: 'a b' }, { callId }));
    expect(result.callId).toBe(callId);
  });

  it('runs an older major version when asked for it', async () => {
    const v1 = fxTool({ version: '1.0.0', run: async () => ok({ n: 1 }) });
    const v2 = fxTool({ version: '2.0.0', run: async () => ok({ n: 2 }) });
    const { executor } = setup({ modules: [fxModule(v1, v2)] });
    expect(unwrap(await executor.execute('fx.thing', {})).value).toEqual({ n: 2 });
    expect(unwrap(await executor.execute('fx.thing', {}, { version: '1' })).value).toEqual({ n: 1 });
  });

  it('applies input defaults before the tool sees the input', async () => {
    const seen: unknown[] = [];
    const tool = fxTool({ run: async (input) => (seen.push(input), ok({ n: 1 })) });
    const { executor } = setup({ modules: [fxModule(tool)] });
    await executor.execute('fx.thing', {});
    expect(seen).toEqual([{ n: 1 }]);
  });
});

describe('execute: failures are values, never throws', () => {
  it('reports unknown tools, with a span', async () => {
    const { executor, events } = setup();
    const result = await executor.execute('testdomain.nothing', {});
    expect(!result.ok && result.error).toMatchObject({
      code: 'tools.not_found',
      params: { tool: 'testdomain.nothing' },
    });
    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.finished']);
    expect(events[1]).toMatchObject({ error: { code: 'tools.not_found' } });
  });

  it('rejects invalid input with the zod issues in detail, without running the tool', async () => {
    const run = vi.fn(async () => ok({ n: 1 }));
    const { executor } = setup({ modules: [fxModule(fxTool({ run }))] });
    const result = await executor.execute('fx.thing', { n: 'seven' });
    expect(!result.ok && result.error.code).toBe('tools.invalid_input');
    expect(!result.ok && result.error.detail).toMatch(/n/);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects output that breaks the tool’s own schema', async () => {
    const tool = fxTool({ run: async () => ok({ n: 'not a number' }) });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const result = await executor.execute('fx.thing', {});
    expect(!result.ok && result.error.code).toBe('tools.invalid_output');
  });

  it('passes a tool’s own error through unchanged', async () => {
    const tool = fxTool({ run: async () => err(Flaky({}, { detail: 'nope' })) });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const result = await executor.execute('fx.thing', {});
    expect(!result.ok && result.error).toEqual(Flaky({}, { detail: 'nope' }));
  });

  it('turns a throw, or a run that returns no Result, into tools.crashed', async () => {
    const throws = fxTool({
      run: async () => {
        throw new RangeError('bug');
      },
    });
    const { executor } = setup({ modules: [fxModule(throws)] });
    const thrown = await executor.execute('fx.thing', {});
    expect(!thrown.ok && thrown.error).toMatchObject({ code: 'tools.crashed', detail: 'RangeError: bug' });

    const bare = fxTool({ run: (async () => ({ n: 1 })) as never });
    const second = setup({ modules: [fxModule(bare)] });
    const result = await second.executor.execute('fx.thing', {});
    expect(!result.ok && result.error.code).toBe('tools.crashed');
  });

  it('keeps a thrown TaalcutError, and crashes on throws outside run()', async () => {
    const tool = fxTool({
      run: async () => {
        throw Flaky();
      },
    });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const thrown = await executor.execute('fx.thing', {});
    expect(!thrown.ok && thrown.error.code).toBe('fx.flaky');
    const estimator = fxTool({
      run: async () => ok({ n: 1 }),
      estimateCost: () => {
        throw new Error('estimate bug');
      },
    });
    const second = setup({ modules: [fxModule(estimator)] });
    const result = await second.executor.execute('fx.thing', {});
    expect(!result.ok && result.error).toMatchObject({
      code: 'tools.crashed',
      detail: 'Error: estimate bug',
    });
  });

  it('ignores a tracing listener that throws', async () => {
    const { executor } = setup({
      onEvent: () => {
        throw new Error('listener bug');
      },
    });
    expect((await executor.execute('testdomain.countWords', { text: 'a' })).ok).toBe(true);
  });
});

describe('context: progress, usage and artifacts', () => {
  it('reports clamped progress and sums usage', async () => {
    const tool = fxTool({
      run: async (_input, ctx) => {
        ctx.reportProgress(-1);
        ctx.reportProgress(0.5, 'half');
        ctx.reportProgress(7);
        ctx.reportUsage({ usd: 0.01, inputTokens: 100 });
        ctx.reportUsage({ usd: 0.02, outputTokens: 5 });
        return ok({ n: 1 });
      },
    });
    const { executor, events } = setup({ modules: [fxModule(tool)] });
    const result = unwrap(await executor.execute('fx.thing', {}));
    expect(result.usage).toEqual({ usd: 0.03, inputTokens: 100, outputTokens: 5 });
    expect(events.filter((e) => e.type === 'tool.progress').map((e) => [e.fraction, e.note])).toEqual([
      [0, undefined],
      [0.5, 'half'],
      [1, undefined],
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', usage: result.usage });
  });

  it('stores large outputs as artifacts and gives the model a reference and summary', async () => {
    const clips = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, title: `Clip ${i}`, seconds: i }));
    const artifacts = createMemoryArtifactStore();
    const { executor } = setup({ services: fakeServices({ clips }), artifacts, inlineOutputLimit: 256 });
    const result = unwrap(await executor.execute('testdomain.listClips', {}));
    expect(result.value).toEqual({ clips });
    expect(result.output.kind).toBe('artifact');
    if (result.output.kind !== 'artifact') return;
    expect(result.output.ref).toMatchObject({ mediaType: 'application/json', summary: '50 clips.' });
    const stored = unwrap(await artifacts.get(result.output.ref.id));
    expect(JSON.parse(new TextDecoder().decode(stored.data))).toEqual({ clips });
  });

  it('writes a default summary, and stays inline with no store or a failing store', async () => {
    const big = fxTool({ output: z.object({ s: z.string() }), run: async () => ok({ s: 'x'.repeat(500) }) });
    const artifacts = createMemoryArtifactStore();
    const spilled = unwrap(
      await setup({ modules: [fxModule(big)], artifacts, inlineOutputLimit: 100 }).executor.execute(
        'fx.thing',
        {},
      ),
    );
    // Names the tool and the size, and quotes none of the output.
    expect(spilled.output.kind === 'artifact' && spilled.output.ref.summary).toBe(
      'fx.thing returned 508 bytes of JSON, stored as an artifact.',
    );
    const noStore = setup({ modules: [fxModule(big)], inlineOutputLimit: 100 });
    expect(unwrap(await noStore.executor.execute('fx.thing', {})).output.kind).toBe('inline');
    const failing = { put: async () => err(Flaky()), get: artifacts.get };
    const failed = setup({ modules: [fxModule(big)], artifacts: failing, inlineOutputLimit: 100 });
    expect(unwrap(await failed.executor.execute('fx.thing', {})).output.kind).toBe('inline');
  });

  it('gives tools an artifact store that says so when none is wired', async () => {
    let seen: unknown;
    const tool = fxTool({
      run: async (_input, ctx: ToolContextBase) => {
        seen = await ctx.artifacts.put({ mediaType: 'text/plain', data: 'x', summary: 's' });
        await ctx.artifacts.get(newId());
        return ok({ n: 1 });
      },
    });
    await setup({ modules: [fxModule(tool)] }).executor.execute('fx.thing', {});
    expect(seen).toMatchObject({
      ok: false,
      error: { code: 'tools.service_unavailable', params: { service: 'artifacts' } },
    });
  });
});

describe('cache', () => {
  it('serves repeat reads of cacheable tools by content hash', async () => {
    let now = 1_000;
    const run = vi.fn(async () => ok({ n: 1 }));
    const tool = fxTool({ run, cache: { ttlMs: 100 } });
    const { executor, events } = setup({ modules: [fxModule(tool)], now: () => now });
    unwrap(await executor.execute('fx.thing', { n: 1 }));
    const hit = unwrap(await executor.execute('fx.thing', { n: 1 }));
    expect(hit).toMatchObject({ cached: true, attempts: 0, value: { n: 1 } });
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', cached: true });
    // Defaults are applied before hashing, so {} and { n: 1 } are the same call.
    expect(unwrap(await executor.execute('fx.thing', {})).cached).toBe(true);
    expect(unwrap(await executor.execute('fx.thing', { n: 2 })).cached).toBe(false);
    now += 101;
    expect(unwrap(await executor.execute('fx.thing', { n: 1 })).cached).toBe(false);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never caches failures or tools that are not cacheable', async () => {
    let calls = 0;
    const tool = fxTool({ cache: true, run: async () => (++calls === 1 ? err(Flaky()) : ok({ n: calls })) });
    const { executor } = setup({ modules: [fxModule(tool)] });
    expect((await executor.execute('fx.thing', {})).ok).toBe(false);
    expect(unwrap(await executor.execute('fx.thing', {})).cached).toBe(false);
    const plain = setup({ services: fakeServices() });
    unwrap(await plain.executor.execute('testdomain.listClips', {}));
    expect(unwrap(await plain.executor.execute('testdomain.listClips', {})).cached).toBe(false);
  });
});
