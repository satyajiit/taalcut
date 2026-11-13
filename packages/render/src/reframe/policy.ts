// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which framing a reframed clip gets (SPEC P3.2, "Policy"), and which detection boxes count at all.
 *
 * | Situation                                                            | Framing                          |
 * | `auto`, an accepted face or human box                                | follow the subject               |
 * | no accepted box for 1.0 s                                            | ease to the centre (target-point) |
 * | wide static: no box or a small median subject, and a still path      | blurred pad                      |
 * | the crop can't show enough of the subject (9:16 footage into 16:9)   | blurred pad                      |
 * | `subject` / `centre` / `blurPad`                                     | as asked, never second-guessed   |
 */
import type { ReframeMode, SubjectSample } from '@taalcut/core';
import type { ReframeConfig } from './config';
import type { FramingReason, SourceRect } from './framing-types';

export interface ScoredBox {
  readonly box: SourceRect;
  readonly confidence: number;
}

export const boxArea = (box: SourceRect): number => Math.max(0, box.width) * Math.max(0, box.height);

/**
 * A box counts at the minimum confidence, unless it is Vision's constant 1.0 "no score" answer covering most of
 * the frame (one blob around everything), which would pan to nothing in particular.
 */
export function isAccepted(scored: ScoredBox, config: ReframeConfig): boolean {
  if (scored.confidence < config.minConfidence) return false;
  const noScore = scored.confidence >= 1 - 1e-6;
  return !(noScore && boxArea(scored.box) > config.noScoreMaxArea);
}

export interface AcceptedBoxes {
  readonly faces: readonly ScoredBox[];
  readonly humans: readonly ScoredBox[];
  /** Only when there is no accepted face or human: attention saliency is the no-person fallback. */
  readonly saliency: readonly ScoredBox[];
}

export function acceptedBoxes(sample: SubjectSample, config: ReframeConfig): AcceptedBoxes {
  const keep = (boxes: readonly ScoredBox[]) => boxes.filter((box) => isAccepted(box, config));
  const faces = keep(sample.faces);
  const humans = keep(sample.humans);
  const saliency = faces.length === 0 && humans.length === 0 ? keep(sample.saliency) : [];
  return { faces, humans, saliency };
}

/** What the shot shows, measured over its samples, for the decision below. */
export interface ShotFacts {
  /** Some sample had an accepted face, human or saliency box. */
  readonly hasSubject: boolean;
  /** Median area (share of the frame) of the accepted subject boxes; null without any. */
  readonly medianSubjectArea: number | null;
  /** Median size of the body box (human, else face) as a share of the frame; null without any. */
  readonly medianBody: { readonly width: number; readonly height: number } | null;
  /** How far the smoothed point travels across the shot, source pixels, per axis. */
  readonly travelPx: { readonly x: number; readonly y: number };
}

export type FramingChoice =
  | { readonly kind: 'follow'; readonly reason: FramingReason }
  | { readonly kind: 'centre'; readonly reason: FramingReason }
  | { readonly kind: 'blurPad'; readonly reason: FramingReason };

/**
 * The framing for a shot: the person's mode first, then (auto) wide static and too-tall subjects pad, a
 * subject is followed, and nothing to follow is the centre crop.
 */
export function chooseFraming(
  mode: ReframeMode,
  facts: ShotFacts,
  crop: { readonly width: number; readonly height: number },
  deadzonePx: number,
  config: ReframeConfig,
): FramingChoice {
  if (mode === 'blurPad') return { kind: 'blurPad', reason: 'forced' };
  if (mode === 'centre') return { kind: 'centre', reason: 'forced' };
  if (mode === 'subject')
    return facts.hasSubject ? { kind: 'follow', reason: 'forced' } : { kind: 'centre', reason: 'noSubject' };
  const small = facts.medianSubjectArea === null || facts.medianSubjectArea < config.wideStaticArea;
  const still = Math.max(facts.travelPx.x, facts.travelPx.y) < deadzonePx;
  if (small && still) return { kind: 'blurPad', reason: 'wideStatic' };
  if (facts.medianBody) {
    const shown = Math.min(crop.width / facts.medianBody.width, crop.height / facts.medianBody.height);
    if (shown < config.minSubjectCoverage) return { kind: 'blurPad', reason: 'subjectTooTall' };
  }
  return facts.hasSubject ? { kind: 'follow', reason: 'subject' } : { kind: 'centre', reason: 'noSubject' };
}

/** The median of a list, or null when it is empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}
