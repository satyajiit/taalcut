// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I2, IX3-I3 for vision's stages: what each reads, what the read ones store (only what their readers read), the
 * versions now that dependent invalidation replaced the coupling (none falls; which config rise raises which), and
 * an analysis re-run keeping a description its input still holds.
 */
import {
  FrameRate,
  newId,
  RationalTime,
  TimeRange,
  type AssetIndexView,
  type ShotDescription,
  type ShotId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../../src/config';
import { visionStageVersions, type StageVersionConfig } from '../../src/jobs/stage-frames';
import { MOTION_CONFIG } from '../../src/motion/config';
import { createVisionIndexStages } from '../../src/jobs/stages';
import { storedAnalyses, storedShots, storedText, withStoredDescriptions } from '../../src/jobs/stored-parts';
import { fakeAnalysis, fakeText } from '../helpers/shot-analysis';

const RATE = FrameRate.of(30);
const range = (start: number, frames: number) =>
  TimeRange.of(RationalTime.of(start, RATE), RationalTime.of(frames, RATE));
const A = newId<'Shot'>() as ShotId;
const B = newId<'Shot'>() as ShotId;

function view(over: Partial<AssetIndexView> = {}): AssetIndexView {
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/clips/a.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [
      { shotId: A, range: range(0, 90), analysis: fakeAnalysis(range(0, 90)) },
      { shotId: B, range: range(90, 20), analysis: fakeAnalysis(range(90, 20), { bestFrame: 7 }) },
    ],
    transcript: null,
    outputs: {
      'vision.shots': { frameCount: 110, cuts: [{ frame: 90, score: 0.9, distance: 0.2, method: 'model' }] },
      'vision.analyse': { shots: [], text: 'vision.ocr' },
    },
    ...over,
  };
}

describe('vision stage versions after the coupling (IX3-I3)', () => {
  it('keeps every version where the coupling left it, so nothing re-runs on upgrade', () => {
    expect(visionStageVersions(VISION_CONFIG)).toEqual({
      'vision.shots': 2,
      // Raised by FRM1-MOT: every indexed shot's camera move is measured (the estimator's version).
      'vision.analyse': 5,
      // Raised by LIB1-FIX: each shot's text is cleaned before it is stored.
      'vision.ocr': 8,
      'vision.embed': 4,
      // Raised on purpose by LRN1-CTX (each shot with what is said and shown around it) and LIB1-FIND (what people
      // are doing): every shot is described again.
      'vision.describe': 4,
      'vision.embedOcr': 2,
      'vision.contactSheet': 1,
    });
    const defined = createVisionIndexStages({
      tier: 'recommended',
      ocrLanguages: () => [],
      placement: () => 'local',
    });
    for (const [stage, version] of Object.entries(visionStageVersions(VISION_CONFIG)))
      expect(defined.find((s) => s.stage === stage)?.version, stage).toBe(version);
  });

  it('raises only the stage a config version belongs to; readers follow what it stores', () => {
    const now = visionStageVersions(VISION_CONFIG);
    const risenBy = (config: StageVersionConfig) => {
      const after = visionStageVersions(config);
      return Object.keys(now).filter(
        (stage) => after[stage as keyof typeof now] !== now[stage as keyof typeof now],
      );
    };
    const bump = (part: 'shots' | 'profile' | 'ocr' | 'embed') => ({
      ...VISION_CONFIG,
      [part]: { ...VISION_CONFIG[part], version: VISION_CONFIG[part].version + 1 },
    });
    expect(risenBy({ ...VISION_CONFIG, version: VISION_CONFIG.version + 1 })).toEqual([
      'vision.shots',
      'vision.analyse',
    ]);
    expect(risenBy(bump('shots'))).toEqual(['vision.shots']);
    expect(risenBy(bump('profile'))).toEqual(['vision.analyse']);
    expect(risenBy(bump('ocr'))).toEqual(['vision.ocr']);
    expect(risenBy(bump('embed'))).toEqual(['vision.embed']);
    // FRM1-MOT: a new camera estimator measures every shot again, and only the analysis runs.
    const motionRisen = visionStageVersions(VISION_CONFIG, MOTION_CONFIG.version + 1);
    expect(
      Object.keys(now).filter(
        (stage) => motionRisen[stage as keyof typeof now] !== now[stage as keyof typeof now],
      ),
    ).toEqual(['vision.analyse']);
  });
});

describe('what vision’s stages read and store (IX3-I2)', () => {
  const byName = (frameInput?: 'proxy') => {
    const all = createVisionIndexStages({
      tier: 'recommended',
      ocrLanguages: () => [],
      placement: () => 'local',
      ...(frameInput ? { frameInput } : {}),
    });
    return (name: string) => all.find((s) => s.stage === name);
  };

  it('declares the stages each one reads, the proxy too where the profile reads it', () => {
    const stage = byName();
    expect(stage('vision.shots')?.reads).toEqual(['media.normalise']);
    expect(stage('vision.analyse')?.reads).toEqual(['vision.shots', 'media.normalise']);
    expect(stage('vision.contactSheet')?.reads).toEqual(['vision.shots', 'vision.analyse', 'media.normalise']);
    expect(stage('vision.describe')?.reads).toEqual(['vision.shots', 'vision.analyse', 'media.normalise']);
    // LIB1-FIX: where the clip was filmed too, so a description waits for it while it's coming and is made again
    // once it lands.
    expect(stage('vision.describe')?.optionalReads).toEqual([
      'vision.ocr',
      'audio.transcript',
      'library.place',
    ]);
    expect(stage('vision.ocr')?.optionalReads).toEqual(['audio.language']);
    const proxy = byName('proxy');
    expect(proxy('vision.shots')?.reads).toEqual(['media.normalise', 'media.proxy']);
    expect(proxy('vision.embed')?.reads).toEqual([
      'vision.shots',
      'vision.analyse',
      'media.normalise',
      'media.proxy',
    ]);
    for (const name of ['vision.shots', 'vision.analyse', 'vision.ocr'])
      expect(stage(name)?.stores, name).toBeDefined();
  });

  it('stores only what readers read: a cut’s score, casting’s curves or a text’s box change nothing', () => {
    const base = view();
    const rescored = view({
      outputs: {
        ...base.outputs,
        'vision.shots': { frameCount: 110, cuts: [{ frame: 90, score: 0.4, distance: 0.2 }] },
      },
    });
    expect(storedShots(rescored)).toEqual(storedShots(base));
    const moved = view({
      outputs: { ...base.outputs, 'vision.shots': { frameCount: 110, cuts: [{ frame: 91, distance: 0.2 }] } },
    });
    expect(storedShots(moved)).not.toEqual(storedShots(base));

    const recurved = view({
      shots: base.shots.map((s) => ({ ...s, analysis: s.analysis && { ...s.analysis, energy: 0.9 } })),
    });
    expect(storedAnalyses(recurved)).toEqual(storedAnalyses(base));
    // LIB1-FIND: a shot whose energy falls under the floor turns still, which vision.describe reads (its motion
    // words go): that changes what the analysis stores, so the clip is described again.
    const stilled = view({
      shots: base.shots.map((s, i) => ({
        ...s,
        analysis: s.analysis && { ...s.analysis, energy: i === 0 ? 0.01 : 0.4 },
      })),
    });
    expect(storedAnalyses(stilled)).not.toEqual(storedAnalyses(base));
    expect(storedAnalyses(stilled).stills).toEqual([base.shots[0]!.shotId]);
    const reframed = view({
      shots: base.shots.map((s) => ({ ...s, analysis: s.analysis && { ...s.analysis, bestFrame: 3 } })),
    });
    expect(storedAnalyses(reframed)).not.toEqual(storedAnalyses(base));
    expect(storedAnalyses(view({ outputs: {} })).output).toBe('none');
    expect(storedAnalyses(view({ outputs: { 'vision.analyse': { shots: [] } } })).output).toBe('analysis');

    const withText = (box: number, words: string) =>
      view({
        shots: [
          {
            shotId: A,
            range: range(0, 90),
            analysis: fakeAnalysis(range(0, 90), {
              onScreenText: [
                { ...fakeText(words, range(0, 30)), box: { x: box, y: 0.8, width: 0.2, height: 0.1 } },
              ],
            }),
          },
          { shotId: B, range: range(90, 20), analysis: fakeAnalysis(range(90, 20)) },
        ],
      });
    expect(storedText(withText(0.1, 'SALE'))).toEqual([[A, ['SALE']]]);
    expect(storedText(withText(0.3, 'SALE'))).toEqual(storedText(withText(0.1, 'SALE')));
    expect(storedText(withText(0.1, 'SOLD'))).not.toEqual(storedText(withText(0.1, 'SALE')));
  });

  it('an analysis re-run keeps a description while the shot’s range and best frame hold', () => {
    const description: ShotDescription = {
      text: 'a ferry at the pier',
      objects: ['ferry'],
      model: { provider: 'local', model: 'stub', local: true },
    };
    const stored = view({
      shots: [
        { shotId: A, range: range(0, 90), analysis: fakeAnalysis(range(0, 90), { description }) },
        {
          shotId: B,
          range: range(90, 20),
          analysis: fakeAnalysis(range(90, 20), { descriptionSkipped: 'no_consent' }),
        },
      ],
    });
    const fresh = [
      { shotId: A, analysis: fakeAnalysis(range(0, 90)) },
      { shotId: B, analysis: fakeAnalysis(range(90, 20), { bestFrame: 3 }) },
    ];
    const [a, b] = withStoredDescriptions(stored, fresh);
    expect(a?.analysis.description).toEqual(description);
    expect(b?.analysis.descriptionSkipped).toBeUndefined();
    expect(b?.analysis.bestFrame).toBe(3);
    const [onlyA] = withStoredDescriptions(stored, [{ shotId: A, analysis: fakeAnalysis(range(0, 80)) }]);
    expect(onlyA?.analysis.description).toBeUndefined();
  });

  it('a kept description or skip replaces a fresh analysis’s "not yet", never stands beside it (IX3-F5, L1)', () => {
    const description: ShotDescription = {
      text: 'a ferry at the pier',
      objects: ['ferry'],
      model: { provider: 'local', model: 'stub', local: true },
    };
    const stored = view({
      shots: [
        { shotId: A, range: range(0, 90), analysis: fakeAnalysis(range(0, 90), { description }) },
        {
          shotId: B,
          range: range(90, 20),
          analysis: fakeAnalysis(range(90, 20), { descriptionSkipped: 'no_consent' }),
        },
      ],
    });
    // What vision.analyse writes: every fresh analysis says "not yet".
    const fresh = [A, B].map((shotId, n) => ({
      shotId,
      analysis: fakeAnalysis(n === 0 ? range(0, 90) : range(90, 20), { descriptionSkipped: 'not_yet' }),
    }));
    const [a, b] = withStoredDescriptions(stored, fresh);
    expect(a?.analysis.description).toEqual(description);
    expect(a?.analysis.descriptionSkipped).toBeUndefined();
    expect(b?.analysis.description).toBeUndefined();
    expect(b?.analysis.descriptionSkipped).toBe('no_consent');
  });

  it('a placed clip’s describe job says where it was filmed; a time-zone guess never does (LIB1-FIX)', () => {
    const stage = createVisionIndexStages({
      tier: 'recommended',
      ocrLanguages: () => [],
      placement: () => 'local',
    }).find((s) => s.stage === 'vision.describe')!;
    const contexts = (place: unknown) => {
      const placed = view();
      const job = stage.job({ ...placed, outputs: { ...placed.outputs, 'library.place': { place } } });
      if ('skip' in job) throw new Error(`skipped: ${job.skip}`);
      const input = job.input as { shots: { context?: { filmedIn?: string } }[] };
      return input.shots.map((shot) => shot.context?.filmedIn);
    };
    const gps = { basis: 'gps', cityId: 2267057, city: 'Lisbon', region: 'Lisbon', country: 'PT', km: 0 };
    expect(contexts(gps)).toEqual(['Lisbon, Portugal', 'Lisbon, Portugal']);
    const zone = { basis: 'zone', offsetMin: -180, offsetFrom: 'file', countries: ['BR'] };
    expect(contexts(zone)).toEqual([undefined, undefined]);
    // Before library.place ran (or with nothing to say), no place.
    expect(contexts(null)).toEqual([undefined, undefined]);
  });

  it('a skipped describe says why on shots without a description and keeps the ones they have (IX3-F5, L1)', () => {
    const description: ShotDescription = {
      text: 'a ferry at the pier',
      objects: ['ferry'],
      model: { provider: 'cloud', model: 'stub', local: false },
    };
    const described = view({
      shots: [
        { shotId: A, range: range(0, 90), analysis: fakeAnalysis(range(0, 90), { description }) },
        { shotId: B, range: range(90, 20), analysis: fakeAnalysis(range(90, 20)) },
      ],
    });
    const stage = createVisionIndexStages({
      tier: 'recommended',
      ocrLanguages: () => [],
      placement: () => 'local',
    }).find((s) => s.stage === 'vision.describe');
    const result = stage?.result?.({ descriptions: [], uploadedTo: [], skipped: 'no_consent' }, described);
    expect(result?.ok).toBe(true);
    const analyses = (result?.ok ? result.value : {}) as {
      analyses?: { shotId: ShotId; analysis: { description?: unknown; descriptionSkipped?: string } }[];
    };
    const [a, b] = analyses.analyses ?? [];
    expect(a?.analysis.description).toEqual(description);
    expect(a?.analysis.descriptionSkipped).toBeUndefined();
    expect(b?.analysis.descriptionSkipped).toBe('no_consent');
  });
});
