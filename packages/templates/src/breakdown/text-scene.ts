// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Composited or scene (BRK1, FIX-SIGN; SPEC "Scene text is never an overlay"). OCR reads every word in the frame:
 * signs, shop fronts, screens, shirts and packaging as well as the titles, captions, chat bubbles, pills, stickers
 * and lower thirds an editor added. Only the added ones are overlays. No one rule tells them apart (the owner's
 * station sign, read three ways as a man's shoulder hid part of it, looked like a chat bubble popping in), so each
 * reading gets a record of evidence, every signal a weight in log-odds that it is the scene's, summed:
 *
 * - **motion** (pixels, text-motion.ts): it moves with the picture behind it (scene), stays put while the picture
 *   moves (composited), or moves its own way (a shirt, a bus); without pixels, the OCR box's drift;
 * - **occlusion**: its ink changes where something passes in front of it, OCR reads it differently over time or it
 *   comes back after a gap (text-sites.ts), or a person of the reel stands in front of it, cutting it;
 * - **perspective**: the OCR quad sits off level or out of square; it is part of a block of signage of other sizes
 *   or scripts; vertical lettering; cut off by the frame's edge;
 * - **lifetime** (weak): it crosses a cut, lives exactly as long as its shot, comes and goes mid-shot, flickers, or
 *   appears with three or more others at a cut;
 * - **look**: a still, even fill that stops on every side (a bubble's or a pill's shape) and rendered contrast.
 *
 * The sum is the score; `sceneLine` and `addedLine` cut it into scene, composited and unsure. An unsure reading
 * leans scene when something stands in front of it, and composited when it sits on a still bounded fill (the owner's
 * rule: no footage contains chat bubbles). What is still unsure is kept with a `textMaybeScene` doubt, and the
 * on-device vision model is asked about it after the job (text-check.ts). Pure and reusable: the record
 * (`TextRegionJudgement`) is what DSG1's reader takes as input.
 */
import { RationalTime, type Box, type FrameRate, type ReelSubjects, type TextOverlay } from '@taalcut/core';
import type { BreakdownConfig } from './config';
import type { OcrQuad } from './ports';
import type { PixelEvidence, SceneSignal } from './text-signals';
import { siteFacts, type SiteFacts } from './text-sites';

/** What the text pass saw of an overlay across its OCR samples. */
export interface TextEvidence {
  /** OCR samples it was read in. */
  readonly samples: number;
  /** How far its box moved across those samples, in box heights (text-track.ts). */
  readonly drift: number;
  /** FIX-SIGN: the OCR's quad of its longest reading, when the engine gives one. */
  readonly quad?: OcrQuad;
  /** FIX-SIGN: other readings right beside it in another size or script: part of a larger block of signage. */
  readonly block?: number;
}

export type TextVerdict = 'overlay' | 'maybeScene' | 'scene';

/** One reading's record: what it is, how sure, and why. */
export interface TextRegionJudgement {
  /** Added in editing, part of the filmed scene, or not settled. */
  readonly kind: 'composited' | 'scene' | 'unsure';
  /** The sum of the signals: log-odds that it is the scene's. */
  readonly score: number;
  /** The score as a probability that it is the scene's (logistic). */
  readonly sceneProbability: number;
  /** Each signal that spoke, with its weighted contribution (positive: scene). */
  readonly signals: Readonly<Partial<Record<SceneSignal, number>>>;
  /** Set when an unsure score was settled by a lean. */
  readonly lean: 'scene' | 'composited' | null;
  /** Readings at one place in one shot share a site (text-sites.ts). */
  readonly site: number;
}

type SceneConfig = BreakdownConfig['textScene'];

/** OCR confidence under this is a doubtful reading. */
const CONFIDENT = 0.75;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ramp = (value: number, from: number, to: number) => clamp01((value - from) / (to - from));

/** How far off level and out of square an OCR quad sits, 0 (a level rectangle) to 1; `aspect` is width / height. */
export function quadTilt(quad: OcrQuad, aspect: number): number {
  const [tl, tr, br, bl] = quad.map((point) => ({ x: point.x * aspect, y: point.y }));
  const angle = (a: typeof tl, b: typeof tl) => (Math.atan2(b!.y - a!.y, b!.x - a!.x) * 180) / Math.PI;
  const top = angle(tl, tr);
  const bottom = angle(bl, br);
  const rotation = (top + bottom) / 2;
  const left = Math.hypot(bl!.x - tl!.x, bl!.y - tl!.y);
  const right = Math.hypot(br!.x - tr!.x, br!.y - tr!.y);
  const shear = Math.abs(angle(tl, bl) - 90 - rotation);
  return Math.max(
    ramp(Math.abs(rotation), 3, 10),
    ramp(Math.abs(top - bottom), 2, 8),
    left > 0 && right > 0 ? ramp(Math.abs(Math.log(left / right)), 0.05, 0.3) : 0,
    ramp(shear, 5, 15),
  );
}

const touchesEdge = (box: Box, margin: number) =>
  box.x <= margin || box.y <= margin || box.x + box.width >= 1 - margin || box.y + box.height >= 1 - margin;

/**
 * A person of the reel stands in front of the text, cutting it: in a third or more of the subject samples during it,
 * a head or body box spans the text's height and covers one end of it but not the other.
 */
export function cutByPerson(
  box: Box,
  span: { readonly start: number; readonly end: number },
  subjects: ReelSubjects | null | undefined,
  rate: FrameRate,
): boolean {
  if (!subjects) return false;
  const during = subjects.samples.filter((sample) => {
    const frame = RationalTime.toFrames(sample.t, rate, 'round');
    return frame >= span.start && frame < span.end;
  });
  if (during.length === 0) return false;
  const cut = during.filter((sample) =>
    [...sample.heads, ...sample.people].some(({ box: person }) => {
      const tall =
        person.y <= box.y + box.height * 0.5 && person.y + person.height >= box.y + box.height * 0.5;
      const coversLeft =
        person.x <= box.x && person.x + person.width > box.x && person.x + person.width < box.x + box.width;
      const coversRight =
        person.x + person.width >= box.x + box.width && person.x > box.x && person.x < box.x + box.width;
      return tall && (coversLeft || coversRight);
    }),
  ).length;
  return cut / during.length >= 1 / 3;
}

export interface WeighOptions {
  /** The frames shots start at (not 0), and the reel's length in frames. */
  readonly cuts: readonly number[];
  readonly total: number;
  readonly rate: FrameRate;
  readonly config: SceneConfig;
  /** The picture's width over its height, for a quad's angles (1 when unknown). */
  readonly aspect?: number;
  /** Index-aligned with the overlays; null where unmeasured. */
  readonly pixels?: readonly (PixelEvidence | null)[];
  readonly subjects?: ReelSubjects | null;
}

/** The signals of one reading, weighted. */
function signalsOf(
  overlay: TextOverlay,
  seen: TextEvidence,
  facts: SiteFacts,
  pixels: PixelEvidence | null,
  options: WeighOptions,
): Partial<Record<SceneSignal, number>> {
  const { config } = options;
  const w = config.weights;
  const out: Partial<Record<SceneSignal, number>> = {};
  const add = (signal: SceneSignal, value: number) => {
    if (value !== 0) out[signal] = Math.round(value * 1000) / 1000;
  };
  const { box } = overlay;
  // Motion: measured from the pixels where it could be; the OCR box's drift otherwise.
  if (pixels && pixels.pairs > 0) {
    add('withPicture', w.withPicture * pixels.withPicture);
    add('fixedOnPicture', w.fixedOnPicture * pixels.fixedOnPicture);
    add('ownMove', w.ownMove * pixels.ownMove);
    add('covered', w.covered * ramp(pixels.covered, 0.2, 0.5));
    // A still, bounded fill round level words: a bubble, a pill or a box. Words at an angle are on a surface.
    const level = !seen.quad || quadTilt(seen.quad, options.aspect ?? 1) < 0.3;
    const shape =
      level && pixels.fill >= 0.7 && pixels.bounded && pixels.withPicture < 0.2 && pixels.ownMove < 0.3;
    if (shape) add('shape', w.shape);
    add('rendered', w.rendered * ramp(pixels.contrast, 150, 210));
  } else if (seen.drift > config.maxDrift) add('drift', w.drift);
  // Occlusion and reading.
  if (facts.misread > 0) add('misread', w.misread);
  if (facts.interrupted) add('interrupted', w.interrupted);
  if (cutByPerson(box, facts.span, options.subjects, options.rate)) add('behindPerson', w.behindPerson);
  // Perspective and place.
  if (seen.quad) add('tilt', w.tilt * quadTilt(seen.quad, options.aspect ?? 1));
  add('block', w.block * Math.min(2, seen.block ?? 0));
  if (box.height >= config.verticalRatio * box.width && [...overlay.text.trim()].length >= 2)
    add('vertical', w.vertical);
  if (touchesEdge(box, config.edgeMargin)) add('edge', w.edge);
  // Lifetime, judged by the site's.
  if (facts.crosses) add('crosses', w.crosses);
  else {
    if (facts.startsWithShot && facts.endsWithShot) add('withShot', w.withShot);
    // A bubble pops in and out mid-shot and stays a while; a reading that flickers mid-shot is the camera's.
    if (facts.short) add('short', w.short);
    else if (!facts.startsWithShot && !facts.endsWithShot && overlay.confidence >= CONFIDENT)
      add('midShot', w.midShot);
  }
  if (facts.crowd) add('crowd', w.crowd);
  // Unrelated readings after one another at a place are captions, unless the place is also misread or hidden.
  if (facts.replaced > 0 && facts.misread === 0 && !facts.interrupted) add('replaced', w.replaced);
  if (overlay.confidence < CONFIDENT) add('doubtful', w.doubtful);
  return out;
}

/** Where and when each reading lives (text-sites.ts), with the config's edges. */
export function factsFor(
  overlays: readonly TextOverlay[],
  options: Pick<WeighOptions, 'cuts' | 'total' | 'rate' | 'config'>,
): SiteFacts[] {
  const { config, rate } = options;
  const fps = RationalTime.toFrames(RationalTime.fromSeconds(1, rate), rate);
  return siteFacts(overlays, {
    cuts: options.cuts,
    total: options.total,
    rate,
    near: config.shotEdgeFrames,
    minFrames: Math.max(1, Math.round(config.minSeconds * fps)),
  });
}

/**
 * Each reading's record. `evidence` and `options.pixels` are index-aligned with `overlays`; the pixels are its
 * site's (text-judge.ts measures each site once, over all its readings' time).
 */
export function weighText(
  overlays: readonly TextOverlay[],
  evidence: readonly (TextEvidence | undefined)[],
  options: WeighOptions,
): TextRegionJudgement[] {
  const { config } = options;
  const facts = factsFor(overlays, options);
  return overlays.map((overlay, index) => {
    const pixels = options.pixels?.[index] ?? null;
    const signals = signalsOf(
      overlay,
      evidence[index] ?? { samples: 1, drift: 0 },
      facts[index]!,
      pixels,
      options,
    );
    const score = Math.round(Object.values(signals).reduce((sum, value) => sum + value, 0) * 1000) / 1000;
    const settled = score >= config.sceneLine ? 'scene' : score <= config.addedLine ? 'composited' : null;
    // Unsure: something in front of it makes it the scene's (an added overlay is always on top); else a still
    // bounded fill is a bubble or a pill, which no footage contains.
    const inFront =
      signals.behindPerson !== undefined ||
      signals.misread !== undefined ||
      signals.interrupted !== undefined ||
      (signals.covered ?? 0) >= config.weights.covered / 2;
    const lean =
      settled !== null ? null : inFront ? 'scene' : signals.shape !== undefined ? 'composited' : null;
    return {
      kind: settled ?? lean ?? 'unsure',
      score,
      sceneProbability: Math.round((1 / (1 + Math.exp(-score))) * 1000) / 1000,
      signals,
      lean,
      site: facts[index]!.site,
    };
  });
}

/** The verdict the breakdown acts on: a composited reading is an overlay; an unsure one is kept and asked about. */
export const verdictOf = (judgement: TextRegionJudgement): TextVerdict =>
  judgement.kind === 'composited' ? 'overlay' : judgement.kind === 'scene' ? 'scene' : 'maybeScene';

/**
 * Each overlay's verdict (BRK1's signature, kept for its callers). `evidence` is index-aligned with `overlays`
 * (absent: one sample, no drift); `cuts` are the frames shots start at (not 0); `total` is the reel's length.
 */
export function judgeText(
  overlays: readonly TextOverlay[],
  evidence: readonly (TextEvidence | undefined)[],
  cuts: readonly number[],
  total: number,
  rate: FrameRate,
  config: SceneConfig,
): TextVerdict[] {
  return weighText(overlays, evidence, { cuts, total, rate, config }).map(verdictOf);
}
