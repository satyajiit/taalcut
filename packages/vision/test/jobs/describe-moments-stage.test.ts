// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1 for the `vision.describe` stage: a shot's frames at the tier's stride with its span (so the describer knows
 * their times), a short shot its best frame alone, the moments stored with the description, kept by an analysis
 * re-run whose input still holds, and their vectors cleared with the description's when nothing is analysed.
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
import type { Tier } from '../../src/config';
import { createVisionIndexStages } from '../../src/jobs/stages';
import { withStoredDescriptions } from '../../src/jobs/stored-parts';
import { fakeAnalysis } from '../helpers/shot-analysis';

const RATE = FrameRate.of(30);
const range = (start: number, frames: number) =>
  TimeRange.of(RationalTime.of(start, RATE), RationalTime.of(frames, RATE));
const LONG = newId<'Shot'>() as ShotId;
const SHORT = newId<'Shot'>() as ShotId;

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
      // 5 s, then 1 s.
      { shotId: LONG, range: range(0, 150), analysis: fakeAnalysis(range(0, 150), { bestFrame: 140 }) },
      { shotId: SHORT, range: range(150, 30), analysis: fakeAnalysis(range(150, 30), { bestFrame: 7 }) },
    ],
    transcript: null,
    outputs: { 'vision.analyse': { shots: [], text: 'vision.ocr' } },
    ...over,
  };
}

const stageFor = (tier: Tier) =>
  createVisionIndexStages({ tier, ocrLanguages: () => [], placement: () => 'local' }).find(
    (s) => s.stage === 'vision.describe',
  )!;

interface JobShot {
  shotId: string;
  frame: number;
  frames?: number[];
  span?: { start: number; length: number };
}

function jobShots(tier: Tier, of: AssetIndexView = view()): JobShot[] {
  const job = stageFor(tier).job(of);
  if ('skip' in job) throw new Error(`skipped: ${job.skip}`);
  return (job.input as { shots: JobShot[] }).shots;
}

describe('vision.describe after MOM1', () => {
  it('asks for a shot’s frames at the tier’s stride, with its span, and a short shot’s best frame alone', () => {
    const [long, short] = jobShots('recommended');
    // One frame a second of a 5 s shot, each in the middle of its second; the best frame is still named.
    expect(long).toMatchObject({
      frame: 140,
      frames: [15, 45, 75, 105, 135],
      span: { start: 0, length: 150 },
    });
    // Under 2 s: one frame, no span, so no moments are asked for.
    expect(short).toMatchObject({ frame: 157 });
    expect(short?.frames).toBeUndefined();
    expect(short?.span).toBeUndefined();
    // A slower Mac looks at fewer frames (one per 1.5 s), a faster one at more (one per 0.75 s).
    expect(jobShots('minimum')[0]?.frames).toEqual([18, 56, 93, 131]);
    expect(jobShots('high')[0]?.frames).toHaveLength(7);
    expect(jobShots('high')[0]?.span).toEqual({ start: 0, length: 150 });
  });

  it('stores the moments with the description and keeps them through an analysis re-run', () => {
    const description: ShotDescription = {
      text: 'A street, then a market.',
      objects: ['street'],
      moments: [
        { start: 0, end: 90, note: 'A street.' },
        { start: 90, end: 150, note: 'A market stall.' },
      ],
      model: { provider: 'on-device', model: 'stub', local: true },
    };
    const stored = view();
    const result = stageFor('recommended').result?.(
      { descriptions: [{ shotId: LONG, description }], uploadedTo: [] },
      stored,
    );
    const value = (result?.ok ? result.value : {}) as {
      descriptions?: { shotId: ShotId; description: ShotDescription }[];
    };
    expect(value.descriptions).toEqual([{ shotId: LONG, description }]);
    // The analysis runs again and nothing it stores moved: the description stays, moments and all.
    const described = view({
      shots: [
        {
          shotId: LONG,
          range: range(0, 150),
          analysis: fakeAnalysis(range(0, 150), { bestFrame: 140, description }),
        },
      ],
    });
    const [kept] = withStoredDescriptions(described, [
      { shotId: LONG, analysis: fakeAnalysis(range(0, 150), { bestFrame: 140 }) },
    ]);
    expect(kept?.analysis.description?.moments).toEqual(description.moments);
  });

  it('clears the moments’ vectors with the description’s when no shot is analysed', () => {
    const job = stageFor('recommended').job(
      view({ shots: [{ shotId: LONG, range: range(0, 150), analysis: null }] }),
    );
    expect(job).toMatchObject({ clears: ['description', 'moment'] });
  });
});
