// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fades through black (IX3-D2). TransNetV2 doesn't mark them (its single-frame head stays under 0.5 through a slow
 * fade; vision SPEC, IX2-C6's real footage), and scdet marked both ends. The analysis pass already runs blackdetect
 * on every frame, so every black run is known without a new decode (black-sides.ts reads around each one).
 *
 * Each side of a black run is hard (scdet saw the picture change in one frame), a lit ramp (the picture fades from
 * or to mean luma at least `litLuma`) or dim (a ramp that never gets lit). A black run is a fade through black when
 * - it neither starts nor ends the asset (a fade in from black at the start, or out at the end, is no boundary), and
 * - one side is a lit ramp and the other a lit ramp too, or hard (a fade out and a cut in from black, a cut to black
 *   and a fade in). A cut to black and back (both sides hard) stays the detector's two cuts. A dim side means no
 *   evidence of another shot: a dark scene drifting in and out of black, or one that brightens until it is lit (a
 *   lamp coming on), is no fade;
 * - the black is empty: flat somewhere (an editor's black, or a fade's bottom), or short (a slow fade with no hold
 *   touches black for a few frames that keep a trace of the picture). A dark scene that blackdetect calls black
 *   keeps its structure, so one entered by a dissolve and left by a cut (or a dissolve) stays the detector's.
 * Its boundary is the middle of the black frames (as a dissolve's is the middle of its span); its span runs from the
 * far end of one ramp to the far end of the other. Fades whose spans still overlap (black, a lit flash, black) are
 * one fade. Every boundary the detector put inside a fade's span, or within one statistics sample of it (the ramps'
 * ends are known to a sample), or whose own span overlaps it, is that fade: one boundary.
 */
import type { PassAnalysis } from '../analysis/frame-pass';
import { SHOT_MODEL_CONFIG } from '../cuts/model-config';
import {
  blackRun,
  joinDimGaps,
  runFrames,
  type BlackRun,
  type BlackSide,
  type FrameSpan,
} from './black-sides';
import type { ShotCut } from './shot-list';

/**
 * - `cutScore`: scdet's score at or above which a change is a hard cut, the model's rule 1 (cuts/model-config.ts).
 * - `litLuma`: a ramp's far end is a lit picture from this mean luma: twice blackdetect's pixel threshold (10 % of
 *   full scale), so a picture most of whose pixels sit near black (night footage) is dark, not lit.
 * - `flatStd`: black is flat where a statistics sample's luma spread (standard deviation, 0–255) is at most this.
 *   Digital black, encoded, measures 0 (every fade and cut to black in fades-v1); its low-key shots, black by
 *   blackdetect's rule for seconds on end, never measure under 1.05.
 * - `shortSeconds`: black this short is a fade's bottom however it is spread (fades-v1's slow fades: 0.2–0.27 s).
 */
export const FADE_CONFIG = {
  cutScore: SHOT_MODEL_CONFIG.cutScore,
  litLuma: 51,
  flatStd: 0.5,
  shortSeconds: 0.5,
} as const;

export interface Fade {
  /** First frame of the new shot: the middle of the black frames. */
  readonly frame: number;
  readonly black: FrameSpan;
  /** From one ramp's far end to the other's. */
  readonly span: FrameSpan;
}

export interface FadeGrid {
  readonly fps: number;
  readonly frameCount: number;
}

const middle = (black: FrameSpan) => Math.round((black.from + black.to + 1) / 2);

const lit = (side: BlackSide) => !side.hard && side.luma >= FADE_CONFIG.litLuma;

/** Black with nothing in it: flat on some sample, or a fade's short bottom. */
function empty(pass: PassAnalysis, black: FrameSpan, fps: number): boolean {
  if ((black.to - black.from + 1) / fps <= FADE_CONFIG.shortSeconds) return true;
  return pass.samples.some(
    (s) => s.index >= black.from && s.index <= black.to && s.std <= FADE_CONFIG.flatStd,
  );
}

function isFade(run: BlackRun, frameCount: number): boolean {
  if (run.black.from <= 0 || run.black.to >= frameCount - 1) return false;
  const { before, after } = run;
  return (lit(before) && (lit(after) || after.hard)) || (before.hard && lit(after));
}

/** Overlapping fades as one: the black from the first's to the last's, the spans joined. */
function joinOverlapping(fades: readonly Fade[]): Fade[] {
  const out: Fade[] = [];
  for (const fade of [...fades].sort((a, b) => a.span.from - b.span.from)) {
    const last = out[out.length - 1];
    if (!last || fade.span.from > last.span.to) {
      out.push(fade);
      continue;
    }
    const black = { from: last.black.from, to: Math.max(last.black.to, fade.black.to) };
    out[out.length - 1] = {
      frame: middle(black),
      black,
      span: { from: last.span.from, to: Math.max(last.span.to, fade.span.to) },
    };
  }
  return out;
}

/** The fades through black in a pass's document; none when it measured no black runs (a document from before). */
export function fadesThroughBlack(pass: PassAnalysis, grid: FadeGrid): Fade[] {
  const runs = (pass.blackRuns ?? []).flatMap((interval) => runFrames(interval, grid.fps) ?? []);
  const fades: Fade[] = [];
  for (const black of joinDimGaps(pass, runs, FADE_CONFIG)) {
    const run = blackRun(pass, black, FADE_CONFIG.cutScore);
    if (!isFade(run, grid.frameCount) || !empty(pass, black, grid.fps)) continue;
    fades.push({ frame: middle(black), black, span: { from: run.before.far, to: run.after.far } });
  }
  return joinOverlapping(fades);
}

const overlaps = (a: FrameSpan, b: FrameSpan) => a.from <= b.to && b.from <= a.to;

/** Whether the detector's boundary is this fade: on its frames (one sample's reach) or its span over them. */
function within(fade: Fade, cut: ShotCut, reach: number): boolean {
  if (cut.span && overlaps(cut.span, fade.span)) return true;
  return cut.frame >= fade.span.from - reach && cut.frame <= fade.span.to + 1 + reach;
}

/**
 * The detector's boundaries with each fade in place of those it covers, in frame order. `reach` is the statistics
 * samples' spacing in frames; `method` the decider's.
 */
export function withFades(
  cuts: readonly ShotCut[],
  fades: readonly Fade[],
  options: { readonly reach: number; readonly method: ShotCut['method'] },
): ShotCut[] {
  const replaced = new Map<Fade, ShotCut[]>(fades.map((fade) => [fade, []]));
  const kept: ShotCut[] = [];
  for (const cut of cuts) {
    const fade = fades.find((f) => within(f, cut, options.reach));
    if (fade) replaced.get(fade)?.push(cut);
    else kept.push(cut);
  }
  const marked = fades.map((fade): ShotCut => ({
    frame: fade.frame,
    score: Math.max(0, ...(replaced.get(fade) ?? []).map((cut) => cut.score)),
    method: options.method,
    kind: 'fade',
    span: fade.span,
  }));
  return [...kept, ...marked].sort((a, b) => a.frame - b.frame);
}

/** The detector's boundaries with the fades through black the pass measured marked in place (both detectors). */
export function markFades(
  cuts: readonly ShotCut[],
  pass: PassAnalysis,
  grid: FadeGrid & { readonly method: ShotCut['method'] },
): ShotCut[] {
  const fades = fadesThroughBlack(pass, grid);
  if (fades.length === 0) return [...cuts];
  return withFades(cuts, fades, { reach: pass.every, method: grid.method });
}
