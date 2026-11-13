// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB's contract §1: whole-head boxes, whole-person boxes and a coarse silhouette on a subject track's detect
 * samples; the frame they are fractions of; the reel's subjects on a template. Additive: a track or a template from
 * before FRM1 still parses.
 */
import { describe, expect, it } from 'vitest';
import {
  encodeSilhouette,
  newId,
  RationalTime,
  reelSubjectsDuring,
  reelSubjectsSchema,
  silhouetteCell,
  silhouetteCells,
  silhouetteSchema,
  silhouetteShare,
  SUBJECT_DETECTORS,
  subjectTrackSchema,
  SubjectSourceToken,
  templateSchema,
  type ReelSubjects,
} from '../src';
import { json, referenceTemplate } from './helpers/documents';

const rate = { num: 30, den: 1 };
const box = { x: 0.3, y: 0.1, width: 0.2, height: 0.25 };

const beforeFrm1 = {
  t: RationalTime.of(0, rate),
  source: 'detect',
  faces: [{ box, confidence: 0.9, roll: 0, yaw: 0, pitch: 0 }],
  humans: [],
  saliency: [],
  subject: { kind: 'face', box, focus: { x: 0.4, y: 0.2 }, confidence: 0.9 },
} as const;

const track = (samples: readonly unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  assetId: newId<'Asset'>(),
  contentHash: 'c'.repeat(64),
  range: { start: RationalTime.of(0, rate), duration: RationalTime.of(60, rate) },
  recipe: {
    faceRevision: 3,
    humanRevision: 2,
    saliencyRevision: 2,
    trackerRevision: 2,
    detectHz: 4,
    trackHz: 12,
    shortSide: 480,
    ...extra,
  },
  compute: { faces: 'neuralEngine', silhouette: 'neuralEngine' },
  samples,
});

describe('subject samples gain heads, people and a silhouette (§1)', () => {
  it('a track from before FRM1 still parses, with none of them', () => {
    const parsed = subjectTrackSchema.parse(track([beforeFrm1]));
    expect(parsed.samples[0]!.heads).toBeUndefined();
    expect(parsed.frame).toBeUndefined();
  });

  it('a detect sample carries heads, people and a silhouette; the track its frame and detector', () => {
    const silhouette = encodeSilhouette(4, 4, [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const sample = {
      ...beforeFrm1,
      heads: [{ box: { x: 0.28, y: 0.04, width: 0.24, height: 0.33 }, confidence: 0.95 }],
      people: [{ box: { x: 0.2, y: 0.04, width: 0.45, height: 0.96 }, confidence: 0.8 }],
      silhouette,
    };
    const parsed = subjectTrackSchema.parse({
      ...track([sample], { headRevision: 1, silhouetteRevision: 1, detector: 'onnx' }),
      frame: { width: 1080, height: 1920 },
    });
    expect(parsed.samples[0]!.heads).toHaveLength(1);
    expect(parsed.recipe.detector).toBe('onnx');
    expect(SUBJECT_DETECTORS).toEqual(['vision', 'onnx']);
  });

  it('heads stay boxes: no landmarks, no identity', () => {
    const marked = { ...beforeFrm1, heads: [{ box, confidence: 1, landmarks: [[0, 0]] }] };
    expect(subjectTrackSchema.safeParse(track([marked])).success).toBe(false);
    const named = { ...beforeFrm1, people: [{ box, confidence: 1, identity: 'p1' }] };
    expect(subjectTrackSchema.safeParse(track([named])).success).toBe(false);
  });

  it('a silhouette whose bits do not fill its grid is refused', () => {
    expect(silhouetteSchema.safeParse({ cols: 4, rows: 4, bits: 'AAAA' }).success).toBe(true);
    expect(silhouetteSchema.safeParse({ cols: 32, rows: 32, bits: 'AAAA' }).success).toBe(false);
    expect(silhouetteSchema.safeParse({ cols: 65, rows: 1, bits: 'AAAAAAAAAAAA' }).success).toBe(false);
  });

  it('the port has its token', () => {
    expect(SubjectSourceToken.key).toBe('core.subjectSource');
  });
});

describe('the silhouette grid', () => {
  const cells = Array.from({ length: 32 * 32 }, (_, i) => {
    const col = i % 32;
    const row = Math.floor(i / 32);
    return col >= 8 && col < 16 && row >= 4;
  });
  const grid = encodeSilhouette(32, 32, cells);

  it('round-trips its cells, row-major from the top left', () => {
    expect(silhouetteSchema.safeParse(grid).success).toBe(true);
    expect(silhouetteCells(grid)).toEqual(cells);
    expect(encodeSilhouette(3, 1, [true, false, true]).bits).toBe('oA==');
  });

  it('answers a point and a box share', () => {
    expect(silhouetteCell(grid, 0.3, 0.5)).toBe(true);
    expect(silhouetteCell(grid, 0.3, 0.05)).toBe(false);
    expect(silhouetteCell(grid, 1, 1)).toBe(false);
    expect(silhouetteShare(grid, { x: 0.25, y: 0.5, width: 0.25, height: 0.25 })).toBeCloseTo(1, 6);
    expect(silhouetteShare(grid, { x: 0.125, y: 0.5, width: 0.25, height: 0.25 })).toBeCloseTo(0.5, 6);
    expect(silhouetteShare(grid, { x: 0, y: 0, width: 0, height: 0 })).toBe(0);
  });

  it('refuses a cell count that is not the grid', () => {
    expect(() => encodeSilhouette(2, 2, [true])).toThrow();
  });
});

describe("the reel's subjects on a template", () => {
  const head = (x: number) => ({ box: { x, y: 0.1, width: 0.2, height: 0.2 }, confidence: 0.9 });
  const subjects: ReelSubjects = {
    version: 1,
    detector: 'vision',
    hz: 4,
    samples: [0, 8, 15, 23].map((frame, i) => ({
      t: RationalTime.of(frame, rate),
      heads: [head(0.1 * i)],
      people: [],
    })),
  };

  it('a template from before FRM1 parses without them, and one with them round-trips', () => {
    const template = referenceTemplate();
    expect(templateSchema.safeParse(json(template)).success).toBe(true);
    const withSubjects = { ...template, subjects };
    const parsed = templateSchema.parse(json(withSubjects));
    expect(parsed.subjects).toEqual(subjects);
  });

  it('refuses an unknown field and a box outside the picture', () => {
    expect(reelSubjectsSchema.safeParse({ ...subjects, perOverlay: {} }).success).toBe(false);
    const outside = { ...subjects, samples: [{ ...subjects.samples[0]!, heads: [head(0.9)] }] };
    expect(reelSubjectsSchema.safeParse(outside).success).toBe(false);
  });

  it('filters a span, or gives the nearest sample to a span too short to hold one', () => {
    const during = reelSubjectsDuring(subjects, RationalTime.of(8, rate), RationalTime.of(10, rate));
    expect(during.map((sample) => sample.t.value)).toEqual([8, 15]);
    const short = reelSubjectsDuring(subjects, RationalTime.of(20, rate), RationalTime.of(1, rate));
    expect(short.map((sample) => sample.t.value)).toEqual([23]);
    expect(
      reelSubjectsDuring({ ...subjects, samples: [] }, RationalTime.of(0, rate), RationalTime.of(1, rate)),
    ).toEqual([]);
  });
});
