// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- render names and version labels: data, never translated */

/**
 * Renders in every state and the timeline versions they and the user kept:
 * the Golden hour Reels export (ready, one loudness warning), a Shorts
 * export of variant 2 rendering, TikTok queued behind it, the Trip reel
 * needing a decision about its captions, the 60 s reel that ran out of
 * disk, a stopped one, and Diwali saved to this Mac.
 */
import type { ExportPresetId, QaReport, RenderId, RenderSnapshot, Timeline } from '@taalcut/core';
import { FIXTURE_NOW } from '../library/assets';
import { fakeUlid } from '../library/seed';
import type { SeededVersion } from './fake-projects';
import { presetName } from './render-snapshot';
import { GOLDEN_RENDER, MAKE_KIND } from './ids';
import { bytesOf, needsAttention, qaReport, summaryOf, WARNED } from './render-data';
import type { SeededProject } from './seeded-project';

const HOUR = 3_600_000;

export interface SeededRender {
  readonly snapshot: RenderSnapshot;
  readonly report: QaReport | null;
}

const framesOf = (timeline: Timeline) =>
  timeline.tracks[0]!.items.reduce(
    (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
    0,
  );

function render(
  n: number,
  project: SeededProject,
  timeline: Timeline,
  presetId: ExportPresetId,
  status: RenderSnapshot['status'],
  hoursAgo: number,
  extra: Partial<RenderSnapshot> = {},
  plan?: Parameters<typeof qaReport>[2],
): SeededRender {
  const id = n === 1 ? GOLDEN_RENDER : fakeUlid<'Render'>(MAKE_KIND.render, n);
  const createdAt = FIXTURE_NOW - hoursAgo * HOUR;
  const done = ['ready', 'needsAttention', 'failed', 'cancelled'].includes(status);
  const report = plan ? qaReport(id as RenderId, presetId, plan, createdAt + 60_000) : null;
  const frames = framesOf(timeline);
  return {
    report,
    snapshot: {
      id: id as RenderId,
      projectId: project.id,
      timelineId: timeline.id,
      timelineRevision: timeline.revision,
      presetId,
      status,
      jobId: fakeUlid<'Job'>(MAKE_KIND.job, n),
      progress: done ? (status === 'ready' ? { fraction: 1 } : null) : null,
      name: `${project.name} – ${presetName(presetId)}`,
      width: 1080,
      height: 1920,
      rate: timeline.canvas.rate,
      durationFrames: frames,
      bytes: status === 'ready' || status === 'needsAttention' ? bytesOf(presetId, frames / 30) : null,
      music: timeline.music.path,
      captions: { burnIn: true, sidecars: [] },
      qa: report ? summaryOf(report) : null,
      supersedes: null,
      notify: false,
      error: null,
      credentials: { added: false, state: null },
      batchId: null,
      createdAt,
      finishedAt: done ? createdAt + 90_000 : null,
      deletedAt: null,
      ...extra,
    },
  };
}

export function seedRenders(projects: readonly SeededProject[]): {
  renders: SeededRender[];
  versions: SeededVersion[];
} {
  const [golden, trip, long, , diwali] = projects as [
    SeededProject,
    SeededProject,
    SeededProject,
    SeededProject,
    SeededProject,
  ];
  const [g1, g2, g3] = golden.timelines as [Timeline, Timeline, Timeline];
  const renders = [
    render(1, golden, g1, 'reels', 'ready', 20, {}, WARNED),
    render(2, golden, g2, 'shorts', 'rendering', 0.05, {
      progress: { fraction: 0.46, stageKey: 'render.stage.capturing', etaMs: 38_000 },
      notify: true,
    }),
    render(3, golden, g3, 'tiktok', 'queued', 0.04),
    render(
      4,
      trip,
      trip.timelines[0]!,
      'reels',
      'needsAttention',
      30,
      {},
      needsAttention(trip.id, trip.timelines[0]!.id),
    ),
    render(5, long, long.timelines[0]!, 'shorts', 'failed', 50, {
      error: { code: 'render.disk_full', messageKey: 'errors.render.disk_full', retryable: true },
    }),
    render(6, trip, trip.timelines[0]!, 'tiktok', 'cancelled', 32),
    render(7, diwali, diwali.timelines[0]!, 'device', 'ready', 21 * 24, {}, { verdict: 'passed' }),
  ];
  const at = (hoursAgo: number) => FIXTURE_NOW - hoursAgo * HOUR;
  const versions: SeededVersion[] = [
    { timelineId: g1.id, kind: 'auto', label: null, snapshot: g1, createdAt: at(26) },
    { timelineId: g1.id, kind: 'named', label: 'First cut', snapshot: g1, createdAt: at(24) },
    { timelineId: g1.id, kind: 'export', label: renders[0]!.snapshot.name, snapshot: g1, createdAt: at(20) },
    { timelineId: g1.id, kind: 'auto', label: null, snapshot: g1, createdAt: at(2) },
    { timelineId: g2.id, kind: 'auto', label: null, snapshot: g2, createdAt: at(26) },
    { timelineId: g3.id, kind: 'auto', label: null, snapshot: g3, createdAt: at(26) },
    {
      timelineId: trip.timelines[0]!.id,
      kind: 'auto',
      label: null,
      snapshot: trip.timelines[0]!,
      createdAt: at(30),
    },
    {
      timelineId: long.timelines[0]!.id,
      kind: 'auto',
      label: null,
      snapshot: long.timelines[0]!,
      createdAt: at(50),
    },
    {
      timelineId: diwali.timelines[0]!.id,
      kind: 'export',
      label: renders[6]!.snapshot.name,
      snapshot: diwali.timelines[0]!,
      createdAt: at(21 * 24),
    },
  ];
  return { renders, versions };
}
