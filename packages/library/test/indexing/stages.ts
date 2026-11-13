// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stub index stages shaped like the real set (hash → normalise → shots →
 * analyse, transcript → embed) and handlers that return valid results
 * without media, so the pipeline's ordering, skips, generations and storage
 * are tested end to end. Handlers count their runs per asset.
 */
import { createHash } from 'node:crypto';
import {
  ASSET_KINDS,
  defineIndexStage,
  defineJobKind,
  NO_RETRY,
  ok,
  RationalTime,
  stageJob,
  TimeRange,
  unwrap,
  type AssetId,
  type IndexStageDefinition,
  type MediaFacts,
  type ShotAnalysis,
  type ShotId,
  type Transcript,
  type VectorIndex,
} from '@taalcut/core';
import { z } from 'zod';
import { createRepositories, type LibraryDatabase } from '../../src/index';
import type { StubHandler } from './harness';

const kind = (name: string) =>
  defineJobKind({ kind: name, input: z.any(), output: z.any(), resource: 'cpu', retry: NO_RETRY });

export const KINDS = {
  hash: kind('test.hashAsset'),
  normalise: kind('test.normalise'),
  shots: kind('test.detectShots'),
  analyse: kind('test.analyse'),
  transcript: kind('test.transcribe'),
  embed: kind('test.embed'),
};

const at30 = (frames: number) => RationalTime.of(frames, { num: 30, den: 1 });
const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });

export function facts(withAudio: boolean, still: boolean): MediaFacts {
  return {
    version: 1,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    ...(still ? {} : { duration: at30(300), frameRate: { num: 30, den: 1 } }),
    variableFrameRate: false,
    hdr: 'none',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
    hasAudio: withAudio,
  };
}

export function analysisFor(range: TimeRange, n: number): ShotAnalysis {
  return {
    version: 1,
    range,
    bestFrame: 0,
    orientation: 'portrait',
    quality: { version: 1, sharpness: 0.8, exposure: 0.8, stability: 0.8, overall: 0.8, flags: [] },
    energy: 0.5,
    onScreenText: [],
    dHash: createHash('sha256').update(`d${n}`).digest('hex').slice(0, 16),
  };
}

const transcript: Transcript = {
  version: 1,
  language: 'en',
  engine: 'parakeet',
  model: 'stub',
  local: true,
  wordTiming: 'native',
  segments: [{ text: 'hello there', range: TimeRange.of(ms(0), ms(800)), language: 'en', words: [] }],
};

export interface StubOptions {
  /** Assets whose (video) facts say there is no audio track: audio.transcript is skipped. */
  readonly silent?: ReadonlySet<AssetId>;
  /** Where vision.embed writes its vectors (ids per shot, so a rerun upserts the same rows). */
  readonly vectors?: VectorIndex;
  /** Called at the start of every handler (a test can hang or kill here). */
  readonly before?: (kind: string, input: { assetId: AssetId }) => Promise<void> | void;
}

export interface StubStages {
  readonly stages: IndexStageDefinition[];
  readonly handlers: Record<string, StubHandler>;
  /** Runs per `<kind> <assetId>`. */
  readonly runs: Map<string, number>;
}

export function stubStages(db: LibraryDatabase, options: StubOptions = {}): StubStages {
  const repos = createRepositories(db);
  const runs = new Map<string, number>();
  const counted =
    (name: string, run: (input: { assetId: AssetId; shotIds?: ShotId[] }) => unknown): StubHandler =>
    async (input) => {
      const typed = input as { assetId: AssetId; shotIds?: ShotId[] };
      await options.before?.(name, typed);
      runs.set(`${name} ${typed.assetId}`, (runs.get(`${name} ${typed.assetId}`) ?? 0) + 1);
      return ok(run(typed));
    };
  const handlers: Record<string, StubHandler> = {
    [KINDS.hash.kind]: counted(KINDS.hash.kind, ({ assetId }) => {
      const hash = createHash('sha256').update(assetId).digest('hex');
      unwrap(repos.assets.setContentHash(assetId, hash));
      return { contentHash: hash };
    }),
    [KINDS.normalise.kind]: counted(KINDS.normalise.kind, ({ assetId }) => {
      const asset = unwrap(repos.assets.get(assetId));
      return {
        facts: facts(asset.kind !== 'image' && !options.silent?.has(assetId), asset.kind === 'image'),
      };
    }),
    [KINDS.shots.kind]: counted(KINDS.shots.kind, () => ({
      ranges: [TimeRange.of(at30(0), at30(150)), TimeRange.of(at30(150), at30(150))],
    })),
    [KINDS.analyse.kind]: counted(KINDS.analyse.kind, (input) => {
      const shots = (input as unknown as { shots: { shotId: ShotId; range: TimeRange }[] }).shots;
      return { analyses: shots.map((s, n) => ({ shotId: s.shotId, analysis: analysisFor(s.range, n) })) };
    }),
    [KINDS.transcript.kind]: counted(KINDS.transcript.kind, () => ({ transcript, language: 'en' })),
    [KINDS.embed.kind]: counted(KINDS.embed.kind, ({ assetId, shotIds = [] }) => {
      if (options.vectors)
        unwrap(
          options.vectors.upsert(
            shotIds.map((shotId, i) => ({
              id: `frame:${shotId}:0`,
              vector: Float32Array.from({ length: 8 }, (_, d) => (d === i % 8 ? 1 : 0.1)),
              metadata: { assetId, kind: 'frame' },
            })),
          ),
        );
      return { count: shotIds.length };
    }),
  };

  const all = [...ASSET_KINDS];
  const stages = [
    defineIndexStage({
      stage: 'library.hash',
      version: 1,
      needs: [],
      appliesTo: all,
      priority: 'normal',
      job: (view) => stageJob(KINDS.hash, { assetId: view.assetId }),
      result: () => ok({}),
    }),
    defineIndexStage({
      stage: 'media.normalise',
      version: 1,
      needs: ['library.hash'],
      appliesTo: all,
      priority: 'normal',
      job: (view) => stageJob(KINDS.normalise, { assetId: view.assetId, path: view.path }),
      result: (output) => ok({ facts: (output as { facts: MediaFacts }).facts }),
    }),
    defineIndexStage({
      stage: 'vision.shots',
      version: 1,
      needs: ['media.normalise'],
      appliesTo: ['video', 'live_photo'],
      priority: 'low',
      job: (view) => stageJob(KINDS.shots, { assetId: view.assetId }),
      result: (output) => ok({ shots: (output as { ranges: TimeRange[] }).ranges }),
    }),
    defineIndexStage({
      stage: 'vision.analyse',
      version: 1,
      needs: ['vision.shots'],
      appliesTo: ['video', 'image', 'live_photo'],
      priority: 'low',
      job: (view) =>
        stageJob(KINDS.analyse, {
          assetId: view.assetId,
          shots: view.shots.map((s) => ({ shotId: s.shotId, range: s.range })),
        }),
      result: (output) => ok({ analyses: (output as { analyses: [] }).analyses }),
    }),
    defineIndexStage({
      stage: 'audio.transcript',
      version: 1,
      needs: ['media.normalise'],
      appliesTo: ['video', 'audio'],
      priority: 'low',
      job: (view) =>
        view.facts?.hasAudio === false
          ? { skip: 'audio.stage.noAudioTrack' }
          : stageJob(KINDS.transcript, { assetId: view.assetId }),
      result: (output) => ok(output as { transcript: Transcript; language: string }),
    }),
    defineIndexStage({
      stage: 'vision.embed',
      version: 1,
      needs: ['vision.analyse', 'audio.transcript'],
      appliesTo: all,
      priority: 'low',
      job: (view) =>
        stageJob(KINDS.embed, { assetId: view.assetId, shotIds: view.shots.map((s) => s.shotId) }),
      result: () => ok({}),
    }),
  ];
  return { stages, handlers, runs };
}
