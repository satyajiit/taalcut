// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  newId,
  ok,
  RationalTime,
  TimeRange,
  type BackgroundModelRequest,
  type ShortsRun,
  type ShortsRunId,
  type TranscriptSegment,
} from '@taalcut/core';
import { vi } from 'vitest';
import type { ShortsDependencies } from '../src/ports';
import type { Proposal } from '../src/proposals';

export const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });
export const range = (start: number, duration: number) => TimeRange.of(ms(start), ms(duration));
export const proposal = (first = 0, last = 2): Proposal => ({
  title: 'A complete lesson',
  reason: 'The source explains and demonstrates the result.',
  hook: 'The source poses a concrete problem.',
  context: 'Enough setup is retained.',
  payoff: 'The result resolves the problem.',
  speech: [{ first, last }],
  visuals: [],
});

export function fixtures(count = 4) {
  const assetId = newId<'Asset'>();
  const projectId = newId<'Project'>();
  const request = {
    assetId,
    projectId,
    duration: ms(60_000),
    platforms: ['shorts' as const, 'reels' as const],
  };
  const segments: TranscriptSegment[] = Array.from({ length: count }, (_, id) => ({
    text: `Sentence ${id}.`,
    range: range(id * 2000, 1800),
    language: 'en',
    words: [
      { text: 'Sentence', range: range(id * 2000, 700) },
      { text: `${id}.`, range: range(id * 2000 + 800, 1000) },
    ],
  }));
  const runs = new Map<ShortsRunId, ShortsRun>();
  const cache = new Map<string, unknown>();
  const calls: BackgroundModelRequest[] = [];
  let reply: (input: BackgroundModelRequest) => unknown = (input) => {
    if (input.system.includes('independent editorial verifier')) return { verdict: 'accept', issues: [] };
    if (input.system.includes('global source context'))
      return { summary: 'The complete source resolves the lesson.' };
    if (input.system.includes('Independently rank')) {
      const data = JSON.parse(
        input.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      ) as Array<{ key: string }>;
      return { best: data.slice(0, 4).map((item) => item.key) };
    }
    if (input.system.includes('Repair this short')) return proposal();
    return { summary: 'A complete lesson with its result.', candidates: [proposal()] };
  };
  const compose = vi.fn(async () => ok({ timelineId: newId<'Timeline'>(), revision: 1 }));
  const deps: ShortsDependencies = {
    source: {
      describe: async () =>
        ok({
          contentHash: 'source-content',
          analysisVersion: 'v1',
          duration: ms(count * 2000),
          hasAudio: true,
        }),
      transcript: vi.fn(async (_id, from, limit) =>
        ok({
          segments: segments.slice(from, from + limit),
          ...(from + limit < segments.length ? { nextSegment: from + limit } : {}),
        }),
      ),
      visuals: async () =>
        ok({
          items: [
            {
              id: 'scene',
              range: range(0, count * 2000),
              description: 'The creator demonstrates a technique.',
            },
          ],
        }),
    },
    models: {
      complete: vi.fn(async (input) => {
        calls.push(input);
        return ok({
          status: 'answered' as const,
          text: JSON.stringify(reply(input)),
          provider: 'recorded',
          model: 'test',
          local: input.placement === 'local',
          costUsd: 0,
          uploadedTo: [],
        });
      }),
    },
    cache: {
      get: async (key) => ok(cache.get(key) ?? null),
      put: async (key, value) => {
        cache.set(key, value);
        return ok(undefined);
      },
    },
    runs: {
      get: async (id) => ok(runs.get(id) ?? null),
      put: async (run) => {
        runs.set(run.id, structuredClone(run));
        return ok(undefined);
      },
      list: async (id) => ok([...runs.values()].filter((run) => run.request.projectId === id)),
    },
    placement: () => 'local',
    modelKey: () => 'recorded:test:v1',
    compose,
  };
  return {
    assetId,
    projectId,
    request,
    segments,
    runs,
    cache,
    calls,
    compose,
    deps,
    respond: (handler: typeof reply) => {
      reply = handler;
    },
  };
}
