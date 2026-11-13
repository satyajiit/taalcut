// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, ids, people's requests), never UI copy */

/**
 * Fixture traces in the shape of packages/agent SPEC section 9, until the
 * agent loop (P1-G2) produces real ones: the gate demo (library.addSource,
 * media.probe, vision.describeFrame) with a retry and a cache hit, a failed run
 * with an approval wait and a gap, and a run still in progress.
 */
import type { RunId, Span, Trace } from '@taalcut/core';

type SpanSpec = Omit<Span, 'spanId' | 'parentSpanId' | 'startedAt' | 'endedAt' | 'events' | 'status'> & {
  at: number;
  ms?: number;
  status?: Span['status'];
  events?: { name: 'retry' | 'fallback'; at: number; detail?: string }[];
  children?: SpanSpec[];
};

/** Flattens a nested spec into spans, depth first, with ids and absolute times. */
function build(base: number, prefix: string, root: SpanSpec): Span[] {
  const spans: Span[] = [];
  let n = 0;
  const walk = (spec: SpanSpec, parentSpanId: string | null) => {
    const { at, ms, children, events, status, ...rest } = spec;
    const spanId = `${prefix}-${++n}`;
    spans.push({
      ...rest,
      spanId,
      parentSpanId,
      startedAt: base + at,
      ...(ms !== undefined ? { endedAt: base + at + ms } : {}),
      status: status ?? (ms === undefined ? 'running' : 'ok'),
      events: (events ?? []).map((e) => ({ ...e, at: base + e.at })),
    });
    for (const child of children ?? []) walk(child, spanId);
  };
  walk(root, null);
  return spans;
}

const model = (
  at: number,
  ms: number,
  tokens: [number, number, number],
  costUsd: number,
  more: Partial<SpanSpec> = {},
): SpanSpec => ({
  kind: 'model',
  name: 'openai/gpt-5.4',
  provider: 'openai',
  model: 'gpt-5.4',
  at,
  ms,
  inputTokens: tokens[0],
  outputTokens: tokens[1],
  cachedInputTokens: tokens[2],
  costUsd,
  stopReason: 'tool_calls',
  ...more,
});

const tool = (name: string, at: number, ms: number | undefined, more: Partial<SpanSpec> = {}): SpanSpec => ({
  kind: 'tool',
  name,
  tool: name,
  version: '1.0.0',
  sideEffect: 'read',
  attempts: 1,
  cacheHit: false,
  deduplicated: false,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  at,
  ...(ms !== undefined ? { ms } : {}),
  ...more,
});

const BASE = Date.UTC(2026, 9, 12, 9, 30, 0);

const gateDemo: Trace = {
  runId: '01K7C9A0B0000000000000GATE' as RunId,
  conversationId: null,
  status: 'succeeded',
  message: 'Add my Goa trip folder and describe the first clip.',
  startedAt: BASE,
  endedAt: BASE + 9_400,
  gaps: [],
  spans: build(BASE, 'gate', {
    kind: 'run',
    name: 'Add my Goa trip folder and describe the first clip.',
    at: 0,
    ms: 9_400,
    children: [
      {
        kind: 'step',
        name: 'Add the Goa folder as a source',
        at: 40,
        ms: 3_060,
        children: [
          model(120, 1_330, [1_072, 210, 2_048], 0.0041),
          tool('library.addSource', 1_500, 220, { sideEffect: 'write' }),
        ],
      },
      {
        kind: 'step',
        name: 'Check the clips',
        at: 3_100,
        ms: 3_100,
        children: [
          model(3_150, 870, [884, 96, 3_200], 0.0024),
          tool('media.probe', 4_050, 1_350, {
            attempts: 2,
            events: [{ name: 'retry', at: 4_600, detail: 'core.timeout' }],
          }),
          tool('media.probe', 4_060, 240, { cacheHit: true }),
        ],
      },
      {
        kind: 'step',
        name: 'Describe the first clip',
        at: 6_200,
        ms: 3_150,
        children: [
          model(6_250, 850, [1_310, 140, 4_096], 0.0036),
          tool('vision.describeFrame', 7_150, 1_500, {
            inputTokens: 1_840,
            outputTokens: 96,
            costUsd: 0.0012,
          }),
          model(8_700, 600, [1_502, 188, 5_120], 0.0039, { stopReason: 'end' }),
        ],
      },
    ],
  }),
};

const failed: Trace = {
  runId: '01K7C9B0C0000000000000FA7D' as RunId,
  conversationId: null,
  status: 'failed',
  message: 'Delete the blurry clips from Sunday.',
  startedAt: BASE + 3_600_000,
  endedAt: BASE + 3_600_000 + 6_800,
  gaps: [{ spanId: 'fail-3', seq: 5, reason: 'no-cost' }],
  spans: build(BASE + 3_600_000, 'fail', {
    kind: 'run',
    name: 'Delete the blurry clips from Sunday.',
    at: 0,
    ms: 6_800,
    status: 'error',
    errorCode: 'library.asset_locked',
    children: [
      {
        kind: 'step',
        name: 'Find blurry clips',
        at: 30,
        ms: 6_700,
        status: 'error',
        children: [
          { ...model(80, 1_120, [2_210, 160, 0], 0), costUsd: undefined },
          tool('library.removeAssets', 1_300, 5_400, {
            sideEffect: 'destructive',
            status: 'error',
            errorCode: 'library.asset_locked',
            children: [{ kind: 'approval', name: 'Delete 4 clips?', at: 1_320, ms: 4_900 }],
          }),
        ],
      },
    ],
  }),
};

const running: Trace = {
  runId: '01K7C9C0D00000000000000RNG' as RunId,
  conversationId: null,
  status: 'running',
  message: 'Make it vertical and add captions.',
  startedAt: BASE + 7_200_000,
  gaps: [],
  spans: build(BASE + 7_200_000, 'live', {
    kind: 'run',
    name: 'Make it vertical and add captions.',
    at: 0,
    children: [
      {
        kind: 'step',
        name: 'Reframe to vertical',
        at: 20,
        children: [model(60, 980, [3_020, 230, 6_144], 0.0068), tool('timeline.reframe', 1_100, undefined)],
      },
    ],
  }),
};

export const TRACE_FIXTURES: readonly Trace[] = [running, failed, gateDemo];
