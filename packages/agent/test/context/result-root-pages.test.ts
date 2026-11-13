// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineTool, defineToolModule, NO_TOOL_RETRY, ok, unwrap } from '@taalcut/core';
import { createMemoryArtifactStore } from '@taalcut/tools';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { readArtifact, readInput } from '../../src/artifact-reader';
import { textTokens } from '../../src/context/compaction';
import { compactExactResults } from '../../src/context/exact-results';
import { loggedResult } from '../../src/context/result-references';
import { buildPromptBlocks } from '../../src/messages';
import { foldEvents } from '../../src/state';
import { call, harness, plan, SOUL, toolText } from '../support/harness';

const input = (value: unknown) => readInput.parse(value);
const missing = (id: string) => `No artifact ${id}.`;
const body = (text: string) => text.split('<untrusted source="artifact">\n')[1]!.split('\n</untrusted>')[0]!;

it('bounds resolved log root pages without a path and preserves every UTF-8 byte across pages', async () => {
  const value = { revision: 3, text: 'हिंदी 日本語 🎬'.repeat(40), scores: [0.123456789, 0.987654321] };
  const deps = {
    loggedResult: (id: string) => (id === 'result:2:0' ? { value } : undefined),
    noArtifact: missing,
    pageTokens: 20,
  };
  const expected = JSON.stringify(value);
  let offset = 0;
  let joined = '';
  while (offset < new TextEncoder().encode(expected).length) {
    const result = await readArtifact(input({ id: 'result:2:0', offset }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.text).toMatch(/^Bytes /);
    const page = body(result.text);
    expect(page).not.toContain('�');
    expect(textTokens(page)).toBeLessThanOrEqual(20);
    joined += page;
    const next = Number(/Bytes \d+-(\d+)/u.exec(result.text)![1]);
    expect(next).toBeGreaterThan(offset);
    offset = next;
  }
  expect(joined).toBe(expected);
  expect(await readArtifact(input({ id: 'result:200:0' }), deps)).toEqual({
    ok: false,
    code: 'core.not_found',
    detail: 'No artifact result:200:0.',
  });
});

it('keeps legacy stored raw bytes and unmeasured log reads unchanged, including partial UTF-8', async () => {
  const artifacts = createMemoryArtifactStore();
  const ref = unwrap(await artifacts.put({ mediaType: 'text/plain', data: 'éx', summary: '' }));
  const deps = {
    artifacts,
    loggedResult: (id: string) => (id === 'result:2:0' ? { value: 'éx' } : undefined),
    noArtifact: missing,
  };
  expect(await readArtifact(input({ id: ref.id, limit: 1 }), { ...deps, pageTokens: 1 })).toEqual({
    ok: true,
    text: 'Bytes 0-1 of 3.\n<untrusted source="artifact">\n�\n</untrusted>',
  });
  expect(await readArtifact(input({ id: 'result:2:0', offset: 1, limit: 1 }), deps)).toEqual({
    ok: true,
    text: 'Bytes 1-2 of 5.\n<untrusted source="artifact">\n�\n</untrusted>',
  });
  expect(await readArtifact(input({ id: 'result:2:0', offset: 99 }), deps)).toEqual({
    ok: true,
    text: 'Bytes 99-5 of 5.\n<untrusted source="artifact">\n\n</untrusted>',
  });
  for (const request of [{ offset: 2 }, { offset: 99 }, { offset: 1, limit: 1 }])
    expect(
      await readArtifact(input({ id: 'result:2:0', ...request }), { ...deps, pageTokens: 20 }),
    ).toMatchObject({
      ok: false,
      code: 'tools.invalid_input',
    });
});

it('pages a stored artifact larger than the measured page with no path, every byte kept', async () => {
  // 0.1.0's installed run: the Maker's stored timeline, read with no path, came back as one 8,192-byte page
  // that the 12,288-token window could not hold, and the make ended with models.context_too_long.
  const artifacts = createMemoryArtifactStore();
  const stored = JSON.stringify({ name: 'Variant 1', clips: 'हिंदी 日本語 🎬 clip '.repeat(600) });
  const ref = unwrap(await artifacts.put({ mediaType: 'application/json', data: stored, summary: '' }));
  const deps = { artifacts, noArtifact: missing, pageTokens: 870 };
  const total = new TextEncoder().encode(stored).length;
  expect(total).toBeGreaterThan(8 * 1024);
  let offset = 0;
  let joined = '';
  let pages = 0;
  while (offset < total) {
    const result = await readArtifact(input({ id: ref.id, offset }), deps);
    if (!result.ok) throw new Error(result.detail);
    const page = body(result.text);
    expect(page).not.toContain('�');
    expect(textTokens(page)).toBeLessThanOrEqual(870);
    joined += page;
    const next = Number(/Bytes \d+-(\d+)/u.exec(result.text)![1]);
    expect(next).toBeGreaterThan(offset);
    offset = next;
    pages++;
  }
  expect(joined).toBe(stored);
  expect(pages).toBeGreaterThan(1);
  // Unmeasured, and measured with room for it, the raw page is the 8,192 bytes it always was.
  for (const pageTokens of [undefined, 100_000]) {
    const whole = await readArtifact(input({ id: ref.id }), {
      artifacts,
      noArtifact: missing,
      ...(pageTokens ? { pageTokens } : {}),
    });
    expect(whole.ok && whole.text.startsWith(`Bytes 0-8192 of ${total}.`)).toBe(true);
  }
});

it('reads "/" as the root where no member has an empty name', async () => {
  const value = { revision: 3, clips: [{ clip: 1 }] };
  const deps = (logged: unknown) => ({
    loggedResult: (id: string) => (id === 'result:2:0' ? { value: logged } : undefined),
    noArtifact: missing,
    pageTokens: 200,
  });
  const root = await readArtifact(input({ id: 'result:2:0', path: '/' }), deps(value));
  expect(root.ok && body(root.text)).toBe(JSON.stringify(value));
  // The pointer keeps its meaning where the member exists.
  const named = await readArtifact(input({ id: 'result:2:0', path: '/' }), deps({ '': 'unnamed', a: 1 }));
  expect(named.ok && body(named.text)).toBe('"unnamed"');
  expect(await readArtifact(input({ id: 'result:2:0', path: '/missing' }), deps(value))).toMatchObject({
    ok: false,
    code: 'core.not_found',
  });
});

it('continues after an omitted selector, receipts only the consumed root page and replays exact readback', async () => {
  const value = { details: '1234567890'.repeat(650), selected: { shot: 'real-shot' } };
  const tool = defineTool({
    name: 'pages.read',
    version: '1.0.0',
    description: 'Reads exact source data.',
    input: z.object({}),
    output: z.object({ details: z.string(), selected: z.object({ shot: z.string() }) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async () => ok(value),
  });
  const h = harness({
    modules: [defineToolModule({ id: 'pages', tools: [tool] })],
    deps: { contextWindow: () => 12_288 },
    script: (request, turn) => {
      if (turn === 0) return plan('Read the source and its selected shot.');
      if (turn === 1) return { toolCalls: [call('findTools', { query: 'pages.read' })] };
      if (turn === 2) return { toolCalls: [call('pages_read')] };
      const text = request.messages.map(toolText).join('\n');
      const id = /result:\d+:\d+/u.exec(text)?.[0];
      if (turn === 3) {
        expect(id).toBeDefined();
        return { toolCalls: [call('readArtifact', { id, offset: 0 })] };
      }
      if (turn === 4) {
        const page = request.messages.map(toolText).find((result) => result.startsWith('Bytes '))!;
        expect(textTokens(body(page))).toBeLessThanOrEqual(870);
        expect(page).not.toContain('Read bytes');
        return { toolCalls: [call('readArtifact', { id, path: '/selected' })] };
      }
      expect(text).toContain('real-shot');
      return { text: 'Read the selected shot without changing the source.' };
    },
  });
  const run = unwrap(await h.agent.run({ conversationId: 'root-page', message: 'Keep every source field.' }));
  expect(run.status).toBe('completed');
  const events = await h.events(run.runId);
  const beforeNext = events.findLastIndex((event) => event.type === 'model.requested');
  const state = foldEvents(run.runId, events.slice(0, beforeNext));
  const blocks = buildPromptBlocks(state, h.registry);
  const indexes = blocks.flatMap((block, index) => (block.kind === 'turn' ? [index] : []));
  const latest = indexes.at(-1)!;
  const root = indexes.find((index) =>
    blocks[index]!.messages.some((message) => toolText(message).startsWith('Bytes ')),
  )!;
  expect(blocks[root]!.readPages).toHaveLength(1);
  compactExactResults(blocks, indexes.slice(0, -1), () => true, 'readPages');
  expect(blocks[root]!.messages.map(toolText).join('\n')).toMatch(/Read bytes 0-\d+\. Reread exactly/);
  expect(blocks[latest]!.messages.map(toolText).join('\n')).toContain('real-shot');
  expect(loggedResult(state, 'result:2:0')).toEqual({ value });
  expect(events.filter((event) => event.type === 'tool.failed')).toEqual([]);
  expect(unwrap(await h.agent.replay(run.runId)).promptDrift).toBe(0);
});

it('receipts a stored artifact’s page read with no path, so the same read twice running still fits', async () => {
  // Past the inline limit, so the executor stores it and the model reads the artifact by its id.
  const value = {
    details: 'A clip of the market at night, seen from the gate. '.repeat(400),
    selected: { shot: 'real-shot' },
  };
  const tool = defineTool({
    name: 'pages.read',
    version: '1.0.0',
    description: 'Reads exact source data.',
    input: z.object({}),
    output: z.object({ details: z.string(), selected: z.object({ shot: z.string() }) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async () => ok(value),
  });
  // A long standing prompt, as the editor's is: the room left holds one page, not two.
  const soul = {
    ...SOUL,
    text: SOUL.text + '\nKeep the material and the requested timing together.'.repeat(200),
  };
  const h = harness({
    modules: [defineToolModule({ id: 'pages', tools: [tool] })],
    deps: { contextWindow: () => 12_288, soul },
    script: (request, turn) => {
      if (turn === 0) return plan('Read the source and its selected shot.');
      if (turn === 1) return { toolCalls: [call('findTools', { query: 'pages.read' })] };
      if (turn === 2) return { toolCalls: [call('pages_read')] };
      const text = request.messages.map(toolText).join('\n');
      const id =
        /artifact ([0-9A-HJKMNP-TV-Z]{26})/u.exec(text)?.[1] ?? /([0-9A-HJKMNP-TV-Z]{26})/u.exec(text)?.[1];
      // The 4B read the same page again before it moved on.
      if (turn <= 5) return { toolCalls: [call('readArtifact', { id })] };
      if (turn === 6) return { toolCalls: [call('readArtifact', { id, path: '/selected' })] };
      expect(text).toContain('real-shot');
      return { text: 'Read the selected shot.' };
    },
  });
  const run = unwrap(
    await h.agent.run({ conversationId: 'stored-page', message: 'Keep every source field.' }),
  );
  const events = await h.events(run.runId);
  expect(run.status, JSON.stringify(events.filter((event) => event.type === 'run.failed'))).toBe('completed');
  const fitted = events.flatMap((event) => (event.type === 'context.compacted' ? [event.payload] : []));
  expect(fitted.length).toBeGreaterThan(0);
  for (const payload of fitted) expect(payload).toMatchObject({ window: 12_288, fits: true });
  const beforeNext = events.findLastIndex((event) => event.type === 'model.requested');
  const state = foldEvents(run.runId, events.slice(0, beforeNext));
  const blocks = buildPromptBlocks(state, h.registry);
  const raw = blocks.filter((block) =>
    block.messages.some((message) => /^Bytes 0-\d+ of /u.test(toolText(message))),
  );
  expect(raw).toHaveLength(3);
  for (const block of raw) expect(block.readPages).toHaveLength(1);
  expect(unwrap(await h.agent.replay(run.runId)).promptDrift).toBe(0);
  // Eight fitted turns of a long prompt and a replay: about 2.4 s alone, 5.8 s once beside the whole suite.
}, 30_000);
