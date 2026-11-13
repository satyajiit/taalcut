// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How far the fake's clips have got (LIB1-PROG), as the library says it since LIB1: each stage's usual length on
 * this Mac (made up, of the order a short phone clip takes on an Apple-silicon Mac), and the job a queued or running
 * stage runs as, with when it started, so the clip page follows its `job.progress`. And Analyse again as the library does
 * it: the steps start over while what the clip had stays (the shots, the words, the description) until each step
 * makes it anew. A re-analysed clip's steps follow its summary's count, which clip-commands.ts moves on each tick;
 * `report` and `step` let a test move it by hand.
 */
import type { AssetDetail, EventBus, Id } from '@taalcut/core';
import { KIND } from './assets';
import { fakeUlid, ulidNumber } from './seed';

type Stage = AssetDetail['stages'][number];

/** The jobs' ids: a kind of their own, one per clip and stage. */
const JOB_KIND = 9;

/** Each stage's usual length here, ms: made up, in the proportions a short clip's steps take. */
export const FAKE_TYPICAL_MS: Readonly<Record<string, number>> = {
  'library.hash': 400,
  'media.normalise': 200,
  'media.thumbnail': 300,
  'vision.shots': 1_800,
  'vision.analyse': 300,
  'vision.ocr': 1_200,
  'vision.embed': 1_200,
  'vision.embedOcr': 300,
  'audio.language': 1_500,
  'audio.transcript': 3_400,
  'vision.embedText': 300,
  'media.proxy': 1_000,
  'media.filmstrip': 900,
  'media.previews': 300,
  'vision.describe': 7_500,
};

/** The fake job of a clip's stage: the same id every time, so a test can name it. */
export function fakeJobId(assetId: string, stage: string): Id<'Job'> {
  const n = ulidNumber(assetId, KIND.asset) ?? 0;
  const at = Object.keys(FAKE_TYPICAL_MS).indexOf(stage);
  return fakeUlid<'Job'>(JOB_KIND, n * 32 + (at < 0 ? 31 : at));
}

/** The stage rows as the library sends them since LIB1: usual lengths, and the job of what is queued or runs. */
export function withStageProgress(
  assetId: string,
  stages: readonly Stage[],
  startedAt: (stage: Stage, typicalMs: number) => number,
): Stage[] {
  return stages.map((stage) => {
    const typical = FAKE_TYPICAL_MS[stage.stage];
    const row: Stage = { ...stage, ...(typical !== undefined ? { typicalMs: typical } : {}) };
    if (stage.state === 'queued') return { ...row, jobId: fakeJobId(assetId, stage.stage) };
    if (stage.state !== 'running') return row;
    return { ...row, jobId: fakeJobId(assetId, stage.stage), startedAt: startedAt(stage, typical ?? 0) };
  });
}

/** A clip analysed again: its steps from the summary's count over its own list; what it had stays. */
export function rerunStages(stages: readonly Stage[], done: number, total: number): Stage[] {
  const at = total <= 0 ? stages.length : Math.floor((done / total) * stages.length);
  return stages.map((stage, index) => {
    const { error: _error, reasonKey: _reason, ...row } = stage;
    if (index < Math.max(1, at)) return { ...row, state: 'done' };
    if (index === at) return { ...row, state: 'running' };
    if (index === at + 1) return { ...row, state: 'queued' };
    return { ...row, state: 'waiting' };
  });
}

export interface FakeAnalysis {
  /** Analyse again started for this clip: from now on its steps follow its summary. */
  readonly start: (assetId: string) => void;
  /** A step finished: the next one starts now. */
  readonly stepped: (assetId: string) => void;
  readonly again: (assetId: string) => boolean;
  /**
   * When the step running now started: when the clip's last step finished, for a clip analysed again; else a third
   * of the way through its usual length, as a clip met mid-step is.
   */
  readonly startedAt: (assetId: string, typicalMs: number) => number;
  /** As a job reports: the running stage of the clip is this far (0..1). For tests and demos. */
  readonly report: (assetId: string, stage: string, fraction: number) => void;
}

export function createFakeAnalysis(events: EventBus): FakeAnalysis {
  const runs = new Map<string, number>();
  return {
    start: (assetId) => runs.set(assetId, Date.now()),
    stepped: (assetId) => {
      if (runs.has(assetId)) runs.set(assetId, Date.now());
    },
    again: (assetId) => runs.has(assetId),
    startedAt: (assetId, typicalMs) => runs.get(assetId) ?? Date.now() - Math.round(typicalMs / 3),
    report: (assetId, stage, fraction) =>
      events.emit('job.progress', {
        jobId: fakeJobId(assetId, stage),
        kind: 'fake.indexStage',
        projectId: null,
        progress: { fraction },
      }),
  };
}
