// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CommandBusToken,
  createContainer,
  FrameRate,
  JobRunnerToken,
  newId,
  ok,
  RationalTime,
  RenderStoreToken,
  type CommandBus,
  type CommandToolContext,
  type JobRunner,
  type RenderStore,
  type ShortsRequest,
  type Timeline,
} from '@taalcut/core';
import type { LibraryDatabase } from '@taalcut/library';
import { beforeEach, expect, it, vi } from 'vitest';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { exportShort } from '../src/utility/roots/shorts-export';

const cache = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@taalcut/library', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createShortsCache: () => cache,
}));

function setup(status: 'ready' | 'needsAttention') {
  const projectId = newId<'Project'>();
  const timelineId = newId<'Timeline'>();
  const renderId = newId<'Render'>();
  const assetId = newId<'Asset'>();
  const request: ShortsRequest = {
    projectId,
    assetId,
    platforms: ['shorts', 'reels'],
    duration: RationalTime.of(60, FrameRate.of(1)),
  };
  const timeline = {
    id: timelineId,
    revision: 7,
    canvas: { rate: FrameRate.of(30) },
    captions: { cues: [{}] },
  } as Timeline;
  const dispatch = vi.fn(async (name: string) =>
    ok({ result: name === 'render.export' ? { renderId } : { assetId } }),
  );
  const run = vi.fn(async () => ok({ renderId, status, qa: null }));
  const container = createContainer()
    .value(CommandBusToken, { dispatch } as unknown as CommandBus)
    .value(JobRunnerToken, { run } as unknown as JobRunner)
    .value(RenderStoreToken, { get: async () => ok({ request: { timelineId } }) } as unknown as RenderStore)
    .value(LibraryDatabaseToken, {} as LibraryDatabase);
  const ctx: CommandToolContext = {
    callId: newId<'ToolRun'>(),
    runId: newId<'AgentRun'>(),
    attempt: 1,
    signal: new AbortController().signal,
    artifacts: { put: vi.fn(), get: vi.fn() },
    dispatch: vi.fn(),
    reportUsage: vi.fn(),
    reportProgress: vi.fn(),
  };
  return { request, timeline, container, ctx, dispatch, run, assetId };
}

beforeEach(() => {
  vi.clearAllMocks();
  cache.put.mockResolvedValue(ok(undefined));
});

it('exports each platform at the finished revision, waits for QA, and registers the exact cover', async () => {
  const s = setup('ready');
  const runId = newId<'ShortsRun'>();
  const result = await exportShort(s.container, runId, s.request, s.timeline, s.ctx);
  expect(result.ok && result.value.issues).toEqual([]);
  expect(s.dispatch.mock.calls.map(([name]) => name)).toEqual([
    'render.export',
    'render.export',
    'render.exportCover',
  ]);
  const first = (s.dispatch.mock.calls[0] as unknown[])[1];
  expect(first).toMatchObject({
    timelineRevision: 7,
    presetId: 'shorts',
    includeBumpers: false,
    captions: { burnIn: true, sidecars: ['srt', 'vtt'] },
  });
  expect(s.run).toHaveBeenCalledTimes(2);
  expect(cache.put).toHaveBeenCalledWith(`shorts.cover:${runId}`, { assetId: s.assetId });
  expect(s.dispatch.mock.calls.some(([name]) => name.startsWith('postiz.'))).toBe(false);
});

it('preserves QA review issues and does not make a publishing cover when export is blocked', async () => {
  const s = setup('needsAttention');
  const result = await exportShort(s.container, newId<'ShortsRun'>(), s.request, s.timeline, s.ctx);
  expect(result.ok && result.value.issues).toHaveLength(2);
  expect(s.dispatch.mock.calls.map(([name]) => name)).toEqual(['render.export', 'render.export']);
  expect(cache.put).not.toHaveBeenCalled();
});
