// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R2's listening-tool fixes:
 * - a spilled output survives the executor's parse (`spec.output`), for every tool that spills (T1: `audio.listen`'s
 *   and `audio.compare`'s all-optional full shapes took it as `{}`);
 * - `audio.critique` with a `templateId` and no profile scores against the template's reel; with `profile: 'launch'`
 *   it is refused (T9b);
 * - listening that outlasts the call goes on in the jobs process, and the tool says so instead of timing out and
 *   cancelling it (a first listen's model download) (T9).
 */
import {
  newId,
  ok,
  type ArtifactStore,
  type AssetId,
  type JobRunner,
  type Result,
  type StoredArtifact,
  type ToolContextBase,
} from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ANALYSIS } from '../../src/listen/analysis/schema';
import { critiqueTool } from '../../src/tools/critique-tool';
import { listenWithin, LISTEN_DETACH_MS } from '../../src/tools/listen-detach';
import { findMomentOutputSchema } from '../../src/tools/listen-search-tools';
import { listenTools } from '../../src/tools/listen-tools';
import { searchSoundsOutputSchema } from '../../src/tools/sfx-search-tool';

function memoryArtifacts(): ArtifactStore {
  const stored = new Map<string, StoredArtifact>();
  return {
    async put(input) {
      const data = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
      const ref = {
        id: newId<'Artifact'>(),
        mediaType: input.mediaType,
        bytes: data.length,
        summary: input.summary,
      };
      stored.set(ref.id, { ref, data });
      return ok(ref);
    },
    get: async (id) => ok(stored.get(id)!),
  };
}

const context = (signal = new AbortController().signal): ToolContextBase => ({
  signal,
  callId: newId<'ToolRun'>(),
  attempt: 1,
  artifacts: memoryArtifacts(),
  reportUsage: () => undefined,
  reportProgress: () => undefined,
});

const assetId = newId<'Asset'>();
const assets = { original: async (id: AssetId) => ok({ path: `/library/${id}.wav`, size: 10, mtimeMs: 1 }) };

/** Jobs whose answers the test gives; each call's signal is kept. */
function fakeJobs(answer: (kind: string, input: Record<string, unknown>) => Promise<unknown> | unknown) {
  const calls: { kind: string; input: Record<string, unknown>; signal?: AbortSignal }[] = [];
  const jobs: Pick<JobRunner, 'run'> = {
    run: (async (
      kind: { kind: string },
      input: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ) => {
      calls.push({ kind: kind.kind, input, ...(options?.signal ? { signal: options.signal } : {}) });
      return ok(await answer(kind.kind, input));
    }) as unknown as JobRunner['run'],
  };
  return { jobs, calls };
}

const tools = (jobs: Pick<JobRunner, 'run'>, extra: object = {}) => {
  const [listen, compare] = listenTools({ jobs, assets, scratch: '/tmp', ...extra });
  return {
    listen: listen!,
    compare: compare!,
    critique: critiqueTool({ jobs, assets, scratch: '/tmp', ...extra }),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('a spilled output through the executor’s parse (T1)', () => {
  const spilled = {
    artifact: { id: newId<'Artifact'>(), mediaType: 'application/json', bytes: 12_000, summary: 's' },
    summary: '5 sound(s) heard; 1: asset X: whoosh (strong).',
  };

  it('stays spilled for every tool that spills', () => {
    const { listen, compare, critique } = tools(fakeJobs(() => EMPTY_ANALYSIS).jobs);
    for (const schema of [
      listen.output,
      compare.output,
      critique.output,
      findMomentOutputSchema,
      searchSoundsOutputSchema,
    ])
      expect(schema.parse(spilled)).toEqual(spilled);
    // A full output is still read as one.
    expect(listen.output.parse({ sounds: [] })).toEqual({ sounds: [] });
    expect(compare.output.parse({ nearest: [] })).toEqual({ nearest: [] });
  });

  it('audio.listen’s ranking of 20 sounds is stored as an artifact the agent can still read', async () => {
    const { jobs } = fakeJobs((_kind, input) => ({
      op: input['op'],
      result: {
        query: 'a riser',
        counts: { strong: 20, plausible: 0, weak: 0 },
        results: Array.from({ length: 20 }, (_, index) => ({
          index,
          z: 3,
          cosine: 0.2,
          vocabPercentile: 99,
          verdict: 'strong',
          nearSilent: false,
          soundsMostLike: {
            term: `a long rising riser ${index} `.repeat(24),
            category: 'whooshes',
            z: 3,
            cosine: 0.2,
          },
        })),
      },
    }));
    const { listen } = tools(jobs);
    const out = await listen.run(
      { sources: Array.from({ length: 20 }, () => ({ assetId })), query: 'a riser' },
      context(),
    );
    if (!out.ok) throw new Error(out.error.code);
    const parsed = listen.output.parse(out.value);
    expect(parsed).toEqual(out.value);
    expect(parsed).toMatchObject({ artifact: { mediaType: 'application/json' } });
    expect(listen.summarize?.(parsed as never)).toMatch(/^Ranked 20 for "a riser"/);
  });
});

describe('audio.critique’s profile (T9b)', () => {
  const heardReel = { version: 1 } as never;

  it('scores against the template’s reel when given a templateId, and refuses one with profile launch', async () => {
    const { jobs, calls } = fakeJobs(() => EMPTY_ANALYSIS);
    const asked: string[] = [];
    const templateId = newId<'Template'>();
    const { critique } = tools(jobs, {
      templateListening: async (id: string) => {
        asked.push(id);
        return ok(heardReel);
      },
    });
    const input = critique.input.parse({ source: { assetId }, templateId });
    const out = await critique.run(input, context());
    expect(out.ok).toBe(true);
    expect(asked).toEqual([templateId]);
    expect(calls[0]?.input).toMatchObject({ critique: { profile: 'reference', reference: heardReel } });
    expect(critique.input.safeParse({ source: { assetId }, templateId, profile: 'launch' }).success).toBe(
      false,
    );
    expect(critique.input.parse({ source: { assetId } })).toEqual({ source: { assetId } });
  });
});

describe('listening that outlasts its call (T9)', () => {
  it('goes on in the background past its time, and says so; a cancel before that cancels it', async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => undefined;
    const { jobs, calls } = fakeJobs(() => new Promise((resolve) => (finish = resolve)));
    const { listen } = tools(jobs);
    const call = new AbortController();
    const pending = listen.run({ sources: [{ assetId }] }, context(call.signal));
    await vi.advanceTimersByTimeAsync(LISTEN_DETACH_MS);
    const out = await pending;
    expect(out.ok ? 'ok' : [out.error.code, out.error.params, out.error.retryable]).toEqual([
      'audio.listen_unavailable',
      { reason: 'still_working' },
      true,
    ]);
    // The job wasn't cancelled with the call: a first download finishes, its analysis is cached.
    call.abort();
    expect(calls[0]?.signal?.aborted).toBe(false);
    finish(EMPTY_ANALYSIS);

    const cancelled = new AbortController();
    const waiting = listenWithin(
      cancelled.signal,
      (signal) =>
        new Promise<Result<string>>((resolve) => {
          signal.addEventListener('abort', () => resolve(ok('stopped')));
        }),
    );
    cancelled.abort();
    expect(await waiting).toEqual(ok('stopped'));
  });

  it('cleans up after the work, not before it', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const out = listenWithin(
      new AbortController().signal,
      () =>
        new Promise<Result<number>>((resolve) => {
          finish = () => {
            order.push('work done');
            resolve(ok(1));
          };
        }),
      { afterMs: 10, cleanup: async () => void order.push('cleanup') },
    );
    await vi.advanceTimersByTimeAsync(10);
    expect((await out).ok).toBe(false);
    expect(order).toEqual([]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['work done', 'cleanup']);
    const quick = await listenWithin(new AbortController().signal, async () => ok(2), {
      cleanup: async () => void order.push('quick cleanup'),
    });
    expect(quick).toEqual(ok(2));
    expect(order.at(-1)).toBe('quick cleanup');
  });
});
