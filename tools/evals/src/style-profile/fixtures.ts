// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The synthetic style profile set (LRN1-STY): three sets of templates stated shot by shot (built into Template
 * documents by @taalcut/templates' syntheticTemplate, so the labels look like real ones), every expected number
 * worked out by hand below (type-7 quartiles, seconds to the millisecond), and renders made like each set or not,
 * with the stylePacing verdict QA should give them (the band is the quartiles widened by 10%). Synthetic: these are
 * not a person's breakdowns, so the report is never a gate claim. Real labels replace them case by case.
 */
import { join } from 'node:path';
import { syntheticTemplate, type SyntheticTemplateSpec } from '@taalcut/templates';
import { writeJson } from '../files';
import type { StyleProfileCase } from './schema';

/** A synthetic case as written here: its templates stated shot by shot. */
interface SyntheticStyleCase extends Omit<StyleProfileCase, 'templates'> {
  readonly templates: readonly SyntheticTemplateSpec[];
}

const band = (n: number, q1: number, median: number, q3: number) => ({ n, q1, median, q3 });

const SYNTHETIC_SETS: readonly SyntheticStyleCase[] = [
  {
    caseId: 'quick-cuts',
    synthetic: true,
    note:
      'Shots 0.5 0.5 1 1 | 0.5 1 1 | 1 1 1.5 1.5 s: sorted 0.5×3, 1×6, 1.5×2, so q1 (h 2.5) 0.75, median (h 5) 1, ' +
      'q3 (h 7.5) 1. Cuts on the beat: (1×3 + 0.5×2) / 5 = 0.8. Shots starting before 3 s: 4, 3, 3. Lengths 3, ' +
      '2.5, 5 s. Band for a render: 0.675 to 1.1 s.',
    templates: [
      {
        index: 1,
        shots: [15, 15, 30, 30],
        hookShotType: 'close',
        transitions: ['whip', null, null],
        cutsOnBeat: 1,
      },
      { index: 2, shots: [15, 30, 30], hookShotType: 'close', transitions: [null, 'whip'], cutsOnBeat: 0.5 },
      { index: 3, shots: [30, 30, 45, 45], hookShotType: 'wide', transitions: ['dissolve', null, null] },
    ],
    expected: {
      members: 3,
      shot: band(11, 0.75, 1, 1),
      cutsOnBeat: 0.8,
      shotsInFirst3s: band(3, 3, 3, 3.5),
      hookShotType: 'close',
      transitions: [
        { value: 'cut', count: 5 },
        { value: 'whip', count: 2 },
        { value: 'dissolve', count: 1 },
      ],
      length: band(3, 2.75, 3, 4),
      aspect: '9:16',
    },
    renders: [
      { name: 'made-like-it', fps: 30, shots: [24, 27, 30, 30, 33], expect: 'pass' },
      { name: 'too-slow', fps: 30, shots: [45, 60, 60, 75], expect: 'fail' },
      { name: 'too-fast', fps: 30, shots: [9, 12, 15, 15], expect: 'fail' },
    ],
  },
  {
    caseId: 'slow-story',
    synthetic: true,
    note:
      'At 25 fps, shots 2 3 4 | 3 4 s: q1 3, median 3, q3 4. No beat maps. Shots starting before 3 s: 2, 1 ' +
      '(the second set’s second shot starts at 3 s). Lengths 9, 7 s. Landscape. Band for a render: 2.7 to 4.4 s.',
    templates: [
      {
        index: 4,
        shots: [50, 75, 100],
        fps: 25,
        canvas: { width: 1920, height: 1080 },
        hookShotType: 'wide',
        transitions: ['dissolve', 'dissolve'],
      },
      {
        index: 5,
        shots: [75, 100],
        fps: 25,
        canvas: { width: 1920, height: 1080 },
        hookShotType: 'wide',
        transitions: ['dissolve'],
      },
    ],
    expected: {
      members: 2,
      shot: band(5, 3, 3, 4),
      cutsOnBeat: null,
      shotsInFirst3s: band(2, 1.25, 1.5, 1.75),
      hookShotType: 'wide',
      transitions: [{ value: 'dissolve', count: 3 }],
      length: band(2, 7.5, 8, 8.5),
      aspect: '16:9',
    },
    renders: [
      { name: 'made-like-it', fps: 30, shots: [90, 105, 120], expect: 'pass' },
      { name: 'too-fast', fps: 30, shots: [30, 30, 45], expect: 'fail' },
    ],
  },
  {
    caseId: 'one-reel',
    synthetic: true,
    note:
      'One 4:5 reel at 24 fps, shots 0.5 0.75 1 1.5 s: q1 (h 0.75) 0.6875 → 0.688, median 0.875, q3 (h 2.25) ' +
      '1.125. Two of three cuts on the beat. Length 3.75 s. Band for a render: 0.619 to 1.238 s.',
    templates: [
      {
        index: 6,
        shots: [12, 18, 24, 36],
        fps: 24,
        canvas: { width: 1080, height: 1350 },
        hookShotType: 'close',
        cutsOnBeat: 0.6667,
      },
    ],
    expected: {
      members: 1,
      shot: band(4, 0.688, 0.875, 1.125),
      cutsOnBeat: 0.667,
      shotsInFirst3s: band(1, 4, 4, 4),
      hookShotType: 'close',
      transitions: [{ value: 'cut', count: 3 }],
      length: band(1, 3.75, 3.75, 3.75),
      aspect: '4:5',
    },
    renders: [
      { name: 'made-like-it', fps: 30, shots: [24, 27, 21], expect: 'pass' },
      { name: 'too-slow', fps: 30, shots: [60, 45], expect: 'fail' },
    ],
  },
];

/** The synthetic cases with their templates built: each a valid Template v1, as the app exports one. */
export const SYNTHETIC_STYLE_CASES: readonly StyleProfileCase[] = SYNTHETIC_SETS.map((item) => ({
  ...item,
  templates: item.templates.map((spec) => syntheticTemplate(spec)),
}));

/** Writes the synthetic set as a label folder (`style-profile.json`). */
export function writeStyleProfileFixtures(outDir: string): string {
  const path = join(outDir, 'style-profile.json');
  writeJson(path, SYNTHETIC_STYLE_CASES);
  return path;
}
