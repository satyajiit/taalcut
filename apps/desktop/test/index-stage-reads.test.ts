// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I2: the jobs process's stages say what they read, and say it truly. For each registered stage, every value
 * of the asset's view its job reads is changed in turn; when the change changes the job the stage builds, a stage
 * it declares it reads, optionally or not (or the stage itself), must store something else too. Otherwise a re-run of the stage that
 * stores that value would leave this one stale, which is exactly what dependent invalidation is for. Plus the
 * declared graph (the library SPEC's map) and the check the pipeline runs on it.
 */
import { describe, expect, it } from 'vitest';
import {
  checkIndexStageMilestones,
  createMemorySettingsStore,
  indexStageMilestone,
  newId,
  RationalTime,
  TimeRange,
  unwrap,
  type AssetIndexView,
  type IndexStageDefinition,
} from '@taalcut/core';
import { checkStageReads } from '@taalcut/library';
import { parseProbeJson, planNormalisation } from '@taalcut/media';
import { indexStageWiring } from '../src/utility/roots/index-stages';
import { mutatedAt, readPaths, type ViewPath } from './helpers/view-reads';

const settings = createMemorySettingsStore();
const stages = indexStageWiring({ tier: async () => 'recommended', settings: () => settings }).stages;

/** The declared graph: each stage and the stages whose stored output it reads (library SPEC, "Dependent invalidation"). */
const READS: Record<string, string[]> = {
  'library.hash': [],
  'media.normalise': [],
  'media.thumbnail': ['media.normalise'],
  'media.proxy': ['media.normalise'],
  'media.filmstrip': ['media.normalise', 'media.proxy'],
  'media.previews': ['media.normalise', 'media.proxy'],
  'library.place': ['media.normalise'],
  'vision.shots': ['media.normalise'],
  'vision.analyse': ['media.normalise', 'vision.shots'],
  'vision.ocr': ['media.normalise', 'vision.analyse', 'vision.shots'],
  'vision.embedOcr': ['vision.ocr'],
  'vision.embed': ['media.normalise', 'vision.analyse', 'vision.shots'],
  'vision.embedText': ['audio.transcript'],
  'vision.contactSheet': ['media.normalise', 'vision.analyse', 'vision.shots'],
  'vision.describe': ['media.normalise', 'vision.analyse', 'vision.shots'],
  'audio.language': ['media.normalise'],
  'audio.transcript': ['audio.language', 'media.normalise'],
  'audio.beats': ['media.normalise'],
};

/** The stages read when they are there, never waited for once they can't come (LRN1-CTX, library SPEC). */
const OPTIONAL_READS: Record<string, string[]> = {
  'vision.ocr': ['audio.language'],
  'vision.describe': ['audio.transcript', 'library.place', 'vision.ocr'],
};

const PROBE = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_type: 'video',
      profile: 'High',
      width: 1920,
      height: 1080,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      time_base: '1/600',
      start_time: '0.000000',
      duration: '10.000000',
      nb_frames: '300',
      disposition: { default: 1, attached_pic: 0 },
    },
    {
      index: 1,
      codec_name: 'aac',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 2,
      channel_layout: 'stereo',
      time_base: '1/48000',
      start_time: '0.000000',
      duration: '10.000000',
      disposition: { default: 1, attached_pic: 0 },
    },
  ],
  format: { filename: 'a.mov', nb_streams: 2, format_name: 'mov,mp4', duration: '10.000000', size: '1000' },
});

/** A video asset every stage would run on: shots analysed, text on one, speech, every read output stored. */
function storedView(): AssetIndexView {
  const plan = unwrap(planNormalisation(unwrap(parseProbeJson('/clips/a.mov', PROBE))));
  const rate = { num: 30, den: 1 };
  const range = (start: number, frames: number) =>
    TimeRange.of(RationalTime.of(start, rate), RationalTime.of(frames, rate));
  const analysis = (start: number, frames: number, text: string[]) => ({
    version: 1 as const,
    range: range(start, frames),
    bestFrame: 12,
    orientation: 'landscape' as const,
    quality: { version: 1, sharpness: 0.8, exposure: 0.7, stability: 0.9, overall: 0.75, flags: [] },
    energy: 0.4,
    onScreenText: text.map((words) => ({
      text: words,
      box: { x: 0.1, y: 0.8, width: 0.5, height: 0.06 },
      range: range(start, 30),
      confidence: 0.9,
      script: 'latin' as const,
      reveal: 'none' as const,
    })),
    dHash: '0123456789abcdef',
  });
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/clips/a.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1000,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: plan.facts,
    derived: [],
    shots: [
      { shotId: newId<'Shot'>(), range: range(0, 150), analysis: analysis(0, 150, ['SALE']) },
      { shotId: newId<'Shot'>(), range: range(150, 150), analysis: analysis(150, 150, []) },
    ],
    transcript: {
      version: 1,
      language: 'en',
      engine: 'whisper',
      model: 'base',
      local: true,
      wordTiming: 'native',
      segments: [{ text: 'hello there', range: range(0, 30), language: 'en', words: [] }],
    },
    outputs: {
      'media.normalise': { plan, facts: plan.facts },
      'media.proxy': { reusedOriginal: true, ratio: 1, overBudget: false, warnings: [] },
      'vision.shots': {
        frameRate: rate,
        frameCount: 300,
        shots: [],
        cuts: [{ frame: 150, score: 0.9, distance: 0.2, method: 'model' }],
      },
      'vision.analyse': { shots: [], text: 'vision.ocr' },
      'audio.language': {
        silent: false,
        measure: {
          integratedLufs: -20,
          loudnessRange: 5,
          truePeakDbtp: -1,
          nonSilentRatio: 0.9,
          nonSilentMs: 9000,
          durationMs: 10000,
        },
        detected: { language: 'en', probability: 0.9, perSlice: [{ language: 'en', probability: 0.9 }] },
      },
    },
  };
}

/** What a stage's job would be for a view, as text (a throw counts as a job of its own). */
function jobOf(stage: IndexStageDefinition, view: AssetIndexView): string {
  try {
    const job = stage.job(view);
    return 'skip' in job
      ? JSON.stringify(job)
      : JSON.stringify([job.kind.kind, job.input, job.priority ?? null]);
  } catch (cause) {
    return `throws ${String(cause)}`;
  }
}

const storedBy = (stage: IndexStageDefinition | undefined, view: AssetIndexView) =>
  stage?.stores ? JSON.stringify(stage.stores(view) ?? null) : undefined;

/** The view's parts that come with the asset, not from a stage's run. */
const IDENTITY = new Set([
  'assetId',
  'generation',
  'kind',
  'path',
  'contentHash',
  'sizeBytes',
  'sourceId',
  'capturedAt',
]);

describe('what the index stages read (IX3-I2)', () => {
  it('declares, for every stage, the stages whose output it reads, and the pipeline accepts the graph', () => {
    expect(Object.fromEntries(stages.map((s) => [s.stage, [...(s.reads ?? ['undeclared'])].sort()]))).toEqual(
      READS,
    );
    expect(
      Object.fromEntries(
        stages.flatMap((s) => (s.optionalReads ? [[s.stage, [...s.optionalReads].sort()]] : [])),
      ),
    ).toEqual(OPTIONAL_READS);
    expect(() => checkStageReads(stages)).not.toThrow();
  });

  it('keeps the searchable milestone: no searchable stage waits on, or optionally reads, a complete-only one', () => {
    expect(() => checkIndexStageMilestones(stages)).not.toThrow();
    const byName = new Map(stages.map((s) => [s.stage, s]));
    const completeOnly = (name: string) => {
      const def = byName.get(name);
      return def !== undefined && indexStageMilestone(def) !== 'searchable';
    };
    const late = stages
      .filter((s) => indexStageMilestone(s) === 'searchable')
      .flatMap((s) => (s.optionalReads ?? []).filter(completeOnly).map((read) => `${s.stage} reads ${read}`));
    expect(late).toEqual([]);
  });

  it('reads nothing a stage it doesn’t name stores: each change that changes its job changes a digest it reads', () => {
    const view = storedView();
    const byName = new Map(stages.map((s) => [s.stage, s]));
    const unread: string[] = [];
    for (const stage of stages) {
      const paths: ViewPath[] = readPaths(view, (recorded) => stage.job(recorded));
      const sources = [stage.stage, ...(stage.reads ?? []), ...(stage.optionalReads ?? [])].map((name) =>
        byName.get(name),
      );
      const before = jobOf(stage, view);
      const stored = sources.map((source) => storedBy(source, view));
      for (const path of paths) {
        if (IDENTITY.has(String(path[0])) || (path[0] === 'outputs' && path[1] === stage.stage)) continue;
        const changed = mutatedAt(view, path);
        if (!changed || jobOf(stage, changed) === before) continue;
        if (!sources.some((source, i) => storedBy(source, changed) !== stored[i]))
          unread.push(`${stage.stage} reads ${path.join('.')}`);
      }
    }
    expect(unread).toEqual([]);
  });
});
