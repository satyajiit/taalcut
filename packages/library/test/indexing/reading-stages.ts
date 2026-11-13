// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stub stages that declare what they read and store (round IX3), shaped like the real ones: shots → analysis →
 * on-screen text → its vectors, frame vectors and descriptions after the analysis, a transcript → its vectors. What
 * each handler returns comes from a `world` the test changes between runs (the cuts, the text on screen, whether
 * the clip speaks), so a re-run can store the same thing or something else. Vectors go to a real sqlite-vec index.
 */
import { createHash } from 'node:crypto';
import {
  defineIndexStage,
  defineJobKind,
  NO_RETRY,
  ok,
  RationalTime,
  TimeRange,
  stageJob,
  unwrap,
  type AssetId,
  type AssetIndexView,
  type IndexStageDefinition,
  type OnScreenText,
  type Result,
  type ShotAnalysis,
  type ShotId,
  type Transcript,
  type VectorIndex,
} from '@taalcut/core';
import { z } from 'zod';
import { createRepositories, type LibraryDatabase } from '../../src/index';
import type { StubHandler } from './harness';
import { analysisFor, facts } from './stages';

const kind = (name: string) =>
  defineJobKind({ kind: name, input: z.any(), output: z.any(), resource: 'cpu', retry: NO_RETRY });
const KINDS = {
  hash: kind('test.hashAsset'),
  normalise: kind('test.normalise'),
  shots: kind('test.detectShots'),
  analyse: kind('test.analyse'),
  ocr: kind('test.readText'),
  transcript: kind('test.transcribe'),
  embedTexts: kind('test.embedTexts'),
  embedFrames: kind('test.embedFrames'),
  describe: kind('test.describe'),
};

const at30 = (frames: number) => RationalTime.of(frames, { num: 30, den: 1 });

/** A handler typed by the input its stage builds (the stub kinds take any input). */
const handle =
  <I>(fn: (input: I) => Result<unknown>): StubHandler =>
  (input) =>
    fn(input as I);

/** What the handlers return on their next run; a test changes it between runs. */
export interface World {
  /** Shot starts (frames at 30 fps) in a 300-frame clip, after 0. */
  cuts: number[];
  /** Text on screen by shot index. */
  text: Record<number, string[]>;
  silent: boolean;
}

export interface ReadingStages {
  readonly stages: IndexStageDefinition[];
  readonly handlers: Record<string, StubHandler>;
  /** Runs per stage, as `<stage> <assetId>`. */
  readonly runs: Map<string, number>;
}

const words = (text: string): Transcript => ({
  version: 1,
  language: 'en',
  engine: 'parakeet',
  model: 'stub',
  local: true,
  wordTiming: 'native',
  segments: [{ text, range: TimeRange.of(at30(0), at30(30)), language: 'en', words: [] }],
});

function ranges(cuts: readonly number[]): TimeRange[] {
  const starts = [0, ...cuts];
  return starts.map((start, i) => TimeRange.of(at30(start), at30((starts[i + 1] ?? 300) - start)));
}

const vector = (seed: string) => {
  const byte = createHash('sha256').update(seed).digest()[0] ?? 0;
  return Float32Array.from({ length: 8 }, (_, d) => (d === byte % 8 ? 1 : 0.1));
};

function onScreen(text: string, range: TimeRange): OnScreenText {
  const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.1 };
  return { text, box, range, confidence: 1, script: 'latin', reveal: 'none' };
}

export function readingStages(db: LibraryDatabase, vectors: VectorIndex, world: World): ReadingStages {
  const repos = createRepositories(db);
  const runs = new Map<string, number>();
  const count = (stage: string, assetId: string) =>
    runs.set(`${stage} ${assetId}`, (runs.get(`${stage} ${assetId}`) ?? 0) + 1);
  const texts = (view: AssetIndexView, kindName: 'ocr' | 'transcript') =>
    kindName === 'ocr'
      ? view.shots.flatMap((s) =>
          (s.analysis?.onScreenText ?? []).map((t, n) => [`ocr:${s.shotId}:${n}`, t.text]),
        )
      : (view.transcript?.segments ?? []).map((s, n) => [`transcript:${view.assetId}:${n}`, s.text]);
  const embedJob = (view: AssetIndexView, kindName: 'ocr' | 'transcript') =>
    stageJob(KINDS.embedTexts, { assetId: view.assetId, kind: kindName, items: texts(view, kindName) });

  const handlers: Record<string, StubHandler> = {
    [KINDS.hash.kind]: handle(({ assetId }: { assetId: AssetId }) => {
      unwrap(repos.assets.setContentHash(assetId, createHash('sha256').update(assetId).digest('hex')));
      return ok({});
    }),
    [KINDS.normalise.kind]: () => ok({ facts: facts(true, false) }),
    [KINDS.shots.kind]: handle(({ assetId }: { assetId: AssetId }) => {
      count('vision.shots', assetId);
      return ok({ ranges: ranges(world.cuts) });
    }),
    [KINDS.analyse.kind]: handle(
      (input: { assetId: AssetId; shots: { shotId: ShotId; range: TimeRange }[] }) => {
        count('vision.analyse', input.assetId);
        return ok({
          analyses: input.shots.map((s, n) => ({ shotId: s.shotId, analysis: analysisFor(s.range, n) })),
        });
      },
    ),
    [KINDS.ocr.kind]: handle(({ assetId, shots }: { assetId: AssetId; shots: ShotId[] }) => {
      count('vision.ocr', assetId);
      return ok({ shots: shots.map((shotId, n) => ({ shotId, texts: world.text[n] ?? [] })) });
    }),
    [KINDS.transcript.kind]: handle(({ assetId }: { assetId: AssetId }) => {
      count('audio.transcript', assetId);
      return ok({ transcript: world.silent ? null : words('hello there') });
    }),
    [KINDS.embedTexts.kind]: handle(
      (input: { assetId: AssetId; kind: 'ocr' | 'transcript'; items: string[][] }) => {
        count(input.kind === 'ocr' ? 'vision.embedOcr' : 'vision.embedText', input.assetId);
        const items = input.items.map(([id = '', text = '']) => ({
          id,
          vector: vector(text),
          metadata: { assetId: input.assetId, kind: input.kind },
        }));
        return vectors.replaceWhere({ assetId: input.assetId, kind: input.kind }, items);
      },
    ),
    [KINDS.embedFrames.kind]: handle(({ assetId }: { assetId: AssetId }) => {
      count('vision.embed', assetId);
      return ok({});
    }),
    [KINDS.describe.kind]: handle(({ assetId }: { assetId: AssetId }) => {
      count('vision.describe', assetId);
      return ok({});
    }),
  };

  const video = ['video'] as const;
  const stages = [
    defineIndexStage({
      stage: 'library.hash',
      version: 1,
      needs: [],
      appliesTo: video,
      priority: 'normal',
      job: (view) => stageJob(KINDS.hash, { assetId: view.assetId }),
      result: () => ok({}),
    }),
    defineIndexStage({
      stage: 'media.normalise',
      version: 1,
      needs: ['library.hash'],
      appliesTo: video,
      priority: 'normal',
      stores: (view) => view.facts,
      job: (view) => stageJob(KINDS.normalise, { assetId: view.assetId }),
      result: (output) => ok({ facts: (output as { facts: ReturnType<typeof facts> }).facts }),
    }),
    defineIndexStage({
      stage: 'vision.shots',
      version: 1,
      needs: ['media.normalise'],
      reads: ['media.normalise'],
      appliesTo: video,
      priority: 'normal',
      stores: (view) => view.shots.map((s) => [s.shotId, s.range]),
      job: (view) => stageJob(KINDS.shots, { assetId: view.assetId }),
      result: (output) => ok({ shots: (output as { ranges: TimeRange[] }).ranges }),
    }),
    defineIndexStage({
      stage: 'vision.analyse',
      version: 1,
      needs: ['vision.shots'],
      reads: ['vision.shots'],
      appliesTo: video,
      priority: 'normal',
      // What the readers read of each analysis, as vision's stage stores it: not the text or description others write.
      stores: (view) =>
        view.shots.map((s) => [s.shotId, s.analysis?.range ?? null, s.analysis?.bestFrame ?? null]),
      job: (view) =>
        stageJob(KINDS.analyse, {
          assetId: view.assetId,
          shots: view.shots.map((s) => ({ shotId: s.shotId, range: s.range })),
        }),
      // Like vision's `withStoredText`: a re-run keeps the text vision.ocr stored on a shot that didn't move.
      result: (output, view) => {
        const stored = new Map(view.shots.map((s) => [s.shotId, s.analysis?.onScreenText ?? []]));
        const { analyses } = output as { analyses: { shotId: ShotId; analysis: ShotAnalysis }[] };
        return ok({
          analyses: analyses.map((a) => ({
            shotId: a.shotId,
            analysis: { ...a.analysis, onScreenText: stored.get(a.shotId) ?? [] },
          })),
        });
      },
    }),
    defineIndexStage({
      stage: 'vision.ocr',
      version: 1,
      needs: ['vision.analyse'],
      reads: ['vision.shots', 'vision.analyse'],
      appliesTo: video,
      priority: 'normal',
      // The words on each shot that shows any: what vision.embedOcr reads (not the boxes or times).
      stores: (view) =>
        view.shots.flatMap((s) =>
          s.analysis?.onScreenText.length ? [[s.shotId, s.analysis.onScreenText.map((t) => t.text)]] : [],
        ),
      job: (view) => stageJob(KINDS.ocr, { assetId: view.assetId, shots: view.shots.map((s) => s.shotId) }),
      result: (output, view) => {
        const read = new Map(
          (output as { shots: { shotId: ShotId; texts: string[] }[] }).shots.map((s) => [s.shotId, s.texts]),
        );
        return ok({
          analyses: view.shots.flatMap((s) =>
            s.analysis
              ? [
                  {
                    shotId: s.shotId,
                    analysis: {
                      ...s.analysis,
                      onScreenText: (read.get(s.shotId) ?? []).map((text) => onScreen(text, s.range)),
                    },
                  },
                ]
              : [],
          ),
        });
      },
    }),
    defineIndexStage({
      stage: 'vision.embedOcr',
      version: 1,
      needs: ['vision.ocr'],
      reads: ['vision.ocr'],
      appliesTo: video,
      priority: 'normal',
      job: (view) =>
        texts(view, 'ocr').length === 0
          ? { skip: 'indexing.skip.noText', clears: ['ocr'] }
          : embedJob(view, 'ocr'),
      result: () => ok({}),
    }),
    defineIndexStage({
      stage: 'vision.embed',
      version: 1,
      needs: ['vision.analyse'],
      reads: ['vision.shots', 'vision.analyse'],
      appliesTo: video,
      priority: 'normal',
      job: (view) => stageJob(KINDS.embedFrames, { assetId: view.assetId }),
      result: () => ok({}),
    }),
    defineIndexStage({
      stage: 'vision.describe',
      version: 1,
      needs: ['vision.analyse'],
      reads: ['vision.shots', 'vision.analyse'],
      appliesTo: video,
      priority: 'low',
      job: (view) => stageJob(KINDS.describe, { assetId: view.assetId }),
      result: () => ok({}),
    }),
    defineIndexStage({
      stage: 'audio.transcript',
      version: 1,
      needs: ['media.normalise'],
      reads: ['media.normalise'],
      appliesTo: video,
      priority: 'normal',
      stores: (view) => view.transcript,
      job: (view) => stageJob(KINDS.transcript, { assetId: view.assetId }),
      result: (output) => ok({ transcript: (output as { transcript: Transcript | null }).transcript }),
    }),
    defineIndexStage({
      stage: 'vision.embedText',
      version: 1,
      needs: ['audio.transcript'],
      reads: ['audio.transcript'],
      appliesTo: video,
      priority: 'normal',
      job: (view) =>
        view.transcript
          ? embedJob(view, 'transcript')
          : { skip: 'indexing.skip.silent', clears: ['transcript'] },
      result: () => ok({}),
    }),
  ];
  return { stages, handlers, runs };
}

/** `stages` with these stages' versions raised by one (a version rise that re-runs them). */
export function risen(
  stages: readonly IndexStageDefinition[],
  names: readonly string[],
): IndexStageDefinition[] {
  return stages.map((s) => (names.includes(s.stage) ? { ...s, version: s.version + 1 } : s));
}
