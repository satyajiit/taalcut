// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scores camera-motion predictions against the eval set's labels (FRM1-MOT), against the plan's bars:
 *
 * - the primary label right (an unsure label counts as wrong: the app would ask instead);
 * - a still camera with a moving subject read as `static`;
 * - zoom direction: no push-in read as a pull-out or the other way;
 * - pan against tilt on clear moves: no clear pan read as a tilt or the other way.
 *
 * Also the two readers before FRM1: the breakdown's `moves` bit and the library's scoreShot class. Pure.
 */
import { CAMERA_MOTIONS, type CameraMotion } from '@taalcut/core';
import { confidenceOf, decideMotion, MOTION_CONFIG, type MotionThresholds } from '@taalcut/vision';
import type { ClipPrediction, Reading } from './predict';

export type ReaderName = 'withBoxes' | 'plain';

export interface BarScore {
  readonly clips: number;
  readonly right: number;
  readonly accuracy: number;
  /** Right and sure (confidence at or over the line). */
  readonly rightAndSure: number;
  readonly unsure: number;
  readonly staticSubject: { readonly clips: number; readonly readStatic: number; readonly share: number };
  readonly zoom: { readonly clips: number; readonly wrongDirection: number; readonly right: number };
  readonly panTilt: { readonly clips: number; readonly swapped: number; readonly right: number };
  readonly confusion: Record<string, Record<string, number>>;
  readonly wrong: { id: string; label: CameraMotion; got: CameraMotion | null; confidence: number }[];
}

export interface BeforeScore {
  readonly clips: number;
  /** The `moves` bit: right when it says moving for every move but a still camera. */
  readonly movesRight: number;
  readonly staticSubjectReadStill: number;
  readonly staticSubjectClips: number;
  /** The library's class right. */
  readonly libraryRight: number;
  readonly libraryStaticSubjectStatic: number;
  readonly libraryZoomRight: number;
  readonly zoomClips: number;
}

const share = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 1000);

/** The label a reading gives with `thresholds` (default: vision's current ones), and whether it is sure. */
export function labelOf(
  reading: Reading,
  thresholds: MotionThresholds = MOTION_CONFIG.classifier,
): { label: CameraMotion | null; sure: boolean; confidence: number } {
  if (reading.features.seconds === 0) return { label: null, sure: false, confidence: 0 };
  const decided = decideMotion(reading.features, Math.sign(reading.measure.scale), thresholds);
  const confidence = confidenceOf(reading.features, decided.clearly);
  return { label: decided.label, sure: confidence >= thresholds.sure, confidence };
}

export function scoreReadings(
  predictions: readonly ClipPrediction[],
  reader: ReaderName,
  thresholds?: MotionThresholds,
): BarScore {
  const confusion: Record<string, Record<string, number>> = {};
  for (const truth of CAMERA_MOTIONS) confusion[truth] = {};
  let right = 0;
  let rightAndSure = 0;
  let unsure = 0;
  const staticSubject = { clips: 0, readStatic: 0 };
  const zoom = { clips: 0, wrongDirection: 0, right: 0 };
  const panTilt = { clips: 0, swapped: 0, right: 0 };
  const wrong: BarScore['wrong'] = [];
  for (const p of predictions) {
    const reading = p[reader];
    const { label, sure, confidence } = labelOf(reading, thresholds);
    const got = label ?? 'none';
    const row = confusion[p.label]!;
    row[got] = (row[got] ?? 0) + 1;
    if (!sure) unsure += 1;
    if (label === p.label) {
      right += 1;
      if (sure) rightAndSure += 1;
    } else wrong.push({ id: p.id, label: p.label, got: label, confidence });
    if (p.move === 'staticSubject') {
      staticSubject.clips += 1;
      if (label === 'static') staticSubject.readStatic += 1;
    }
    if (p.label === 'push-in' || p.label === 'pull-out') {
      zoom.clips += 1;
      if (label === p.label) zoom.right += 1;
      if ((p.label === 'push-in' && label === 'pull-out') || (p.label === 'pull-out' && label === 'push-in'))
        zoom.wrongDirection += 1;
    }
    if (p.clear) {
      panTilt.clips += 1;
      if (label === p.label) panTilt.right += 1;
      if ((p.label === 'pan' && label === 'tilt') || (p.label === 'tilt' && label === 'pan'))
        panTilt.swapped += 1;
    }
  }
  return {
    clips: predictions.length,
    right,
    accuracy: share(right, predictions.length),
    rightAndSure,
    unsure,
    staticSubject: { ...staticSubject, share: share(staticSubject.readStatic, staticSubject.clips) },
    zoom,
    panTilt,
    confusion,
    wrong,
  };
}

export function scoreBefore(predictions: readonly ClipPrediction[]): BeforeScore {
  let movesRight = 0;
  let staticSubjectReadStill = 0;
  let staticSubjectClips = 0;
  let libraryRight = 0;
  let libraryStaticSubjectStatic = 0;
  let libraryZoomRight = 0;
  let zoomClips = 0;
  for (const p of predictions) {
    const still = p.label === 'static';
    if (p.before.breakdownMoves !== null && p.before.breakdownMoves === !still) movesRight += 1;
    if (p.before.library === p.label) libraryRight += 1;
    if (p.move === 'staticSubject') {
      staticSubjectClips += 1;
      if (p.before.breakdownMoves === false) staticSubjectReadStill += 1;
      if (p.before.library === 'static') libraryStaticSubjectStatic += 1;
    }
    if (p.label === 'push-in' || p.label === 'pull-out') {
      zoomClips += 1;
      if (p.before.library === p.label) libraryZoomRight += 1;
    }
  }
  return {
    clips: predictions.length,
    movesRight,
    staticSubjectReadStill,
    staticSubjectClips,
    libraryRight,
    libraryStaticSubjectStatic,
    libraryZoomRight,
    zoomClips,
  };
}

/** Bars met on a score (held-out set). */
export function barsMet(score: BarScore): Record<string, boolean> {
  return {
    primaryLabel95: score.accuracy >= 0.95,
    staticSubject95: score.staticSubject.share >= 0.95,
    zoomDirection100: score.zoom.wrongDirection === 0,
    panTilt100: score.panTilt.swapped === 0,
  };
}

const GRID: Readonly<Partial<Record<keyof MotionThresholds, readonly number[]>>> = {
  moveSpeed: [0.02, 0.025, 0.03, 0.035, 0.04],
  shakeRatio: [0, 2, 3, 4, 6, 8],
  minTravel: [0, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05],
  zoomOverShift: [0.5, 0.65, 0.8, 1, 1.25, 1.5],
  jitter: [0.0003, 0.0004, 0.0005, 0.0006, 0.0008, 0.001, 0.0013, 0.0016, 0.002, 0.0025],
  steadyShare: [0.2, 0.3, 0.4, 0.5, 0.6],
  steadySpeed: [0.03, 0.05, 0.08, 0.12],
  followSpeed: [0.008, 0.01, 0.012, 0.015, 0.02, 0.025],
  followSubject: [0.04, 0.06, 0.08, 0.1, 0.12, 0.15],
  followShake: [1, 1.5, 2, 3, 4],
};

/**
 * The thresholds that get most train clips right over the readers given (with and without subject boxes: one set
 * serves both): coordinate descent over GRID from vision's current numbers, three rounds; a tie keeps the value
 * nearer the middle of its grid.
 */
export function fitThresholds(
  train: readonly ClipPrediction[],
  readers: readonly ReaderName[],
): { thresholds: MotionThresholds; right: number } {
  const rightWith = (thresholds: MotionThresholds) =>
    readers.reduce((sum, reader) => sum + scoreReadings(train, reader, thresholds).right, 0);
  let best: MotionThresholds = { ...MOTION_CONFIG.classifier };
  let bestRight = rightWith(best);
  for (let round = 0; round < 3; round++) {
    for (const [key, values] of Object.entries(GRID) as [keyof MotionThresholds, readonly number[]][]) {
      const middle = (values.length - 1) / 2;
      let chosen = best[key];
      let chosenRight = bestRight;
      for (const [i, value] of values.entries()) {
        const right = rightWith({ ...best, [key]: value });
        const nearer = Math.abs(i - middle) < Math.abs(values.indexOf(chosen) - middle);
        if (right > chosenRight || (right === chosenRight && values.includes(chosen) && nearer)) {
          chosen = value;
          chosenRight = right;
        }
      }
      best = { ...best, [key]: chosen };
      bestRight = chosenRight;
    }
  }
  return { thresholds: best, right: bestRight };
}
