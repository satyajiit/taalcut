// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { everyTenthAnd, type HashSample, hamming, hashPasses } from './hash';
import { durationFrames, type RenderGolden } from './schema';
import { type StripReading } from './strip';

export interface EditSpan {
  clipId: number;
  /** Source frame shown at outputStart. */
  inFrame: number;
  /** Exclusive source frame. */
  outFrame: number;
  outputStart: number;
}

export interface FrameMismatch {
  outputFrame: number;
  expected: StripReading;
  actual: StripReading;
}

export interface CutMatchResult {
  pass: boolean;
  firstMismatch?: FrameMismatch;
}

export interface HashFailure {
  outputFrame: number;
  distance: number;
}

export interface HashCheck {
  /** False when no approved list was supplied. That is a skip, not a failure. */
  approved: boolean;
  pass: boolean;
  failures: HashFailure[];
}

/** Every 10th output frame, plus the first frame of each overlay and caption. */
export function framesToHash(golden: RenderGolden): number[] {
  const extra = [...golden.overlays, ...golden.captions].map((item) => item.startFrame);
  return everyTenthAnd(durationFrames(golden), extra);
}

export function editList(golden: RenderGolden): EditSpan[] {
  const spans: EditSpan[] = [];
  let outputStart = 0;
  for (const clip of golden.clips) {
    spans.push({
      clipId: clip.clipId,
      inFrame: clip.inFrame,
      outFrame: clip.inFrame + clip.frames,
      outputStart,
    });
    outputStart += clip.frames;
  }
  return spans;
}

/** Output frame where each clip after the first starts. */
export function cutFrames(golden: RenderGolden): number[] {
  const cuts: number[] = [];
  let output = 0;
  golden.clips.forEach((clip, index) => {
    if (index > 0) cuts.push(output);
    output += clip.frames;
  });
  return cuts;
}

export function sourceAt(golden: RenderGolden, outputFrame: number): StripReading | undefined {
  let output = 0;
  for (const clip of golden.clips) {
    if (outputFrame >= output && outputFrame < output + clip.frames) {
      return { frame: clip.inFrame + (outputFrame - output), clipId: clip.clipId };
    }
    output += clip.frames;
  }
  return undefined;
}

/** Fails when any output frame's clip id or source frame differs, including a one-frame shift. */
export function cutsMatch(expected: RenderGolden, decodedFrames: readonly StripReading[]): CutMatchResult {
  const duration = durationFrames(expected);
  const total = Math.max(duration, decodedFrames.length);
  for (let outputFrame = 0; outputFrame < total; outputFrame += 1) {
    const wanted = sourceAt(expected, outputFrame);
    const actual = decodedFrames[outputFrame];
    if (
      wanted === undefined ||
      actual === undefined ||
      wanted.frame !== actual.frame ||
      wanted.clipId !== actual.clipId
    ) {
      return {
        pass: false,
        firstMismatch: {
          outputFrame,
          expected: wanted ?? { frame: -1, clipId: -1 },
          actual: actual ?? { frame: -1, clipId: -1 },
        },
      };
    }
  }
  return { pass: true };
}

/** Fails when any cut is more than 1 frame from the nearest beat. */
export function beatsMatch(cuts: readonly number[], beats: readonly number[]): { pass: boolean } {
  for (const cut of cuts) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const beat of beats) {
      const distance = Math.abs(cut - beat);
      if (distance < nearest) nearest = distance;
    }
    if (nearest > 1) return { pass: false };
  }
  return { pass: true };
}

/**
 * Compare approved dHashes. A missing approval list is `approved: false` and
 * does not fail. A distance above 6 fails.
 */
export function checkHashes(
  actualHex: readonly HashSample[] | undefined,
  approvedHex: readonly HashSample[] | undefined,
): HashCheck {
  if (approvedHex === undefined) return { approved: false, pass: true, failures: [] };
  const actualByFrame = new Map(actualHex?.map((sample) => [sample.outputFrame, sample.dHash.toLowerCase()]));
  const failures: HashFailure[] = [];
  for (const sample of approvedHex) {
    const actual = actualByFrame.get(sample.outputFrame);
    if (actual === undefined) {
      failures.push({ outputFrame: sample.outputFrame, distance: 64 });
      continue;
    }
    const distance = hamming(actual, sample.dHash);
    if (!hashPasses(distance)) failures.push({ outputFrame: sample.outputFrame, distance });
  }
  return { approved: true, pass: failures.length === 0, failures };
}
