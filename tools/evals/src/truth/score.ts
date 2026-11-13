// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scores a breakdown's template against a reel's truth file (BRK1-ACC), item by item: cuts, the fade's tail, the
 * overlays (kept, marked, or scene text that would reach a made video), the intents, speech, the tempo, the
 * downbeats, the export's orientation and the doubts. Pure: the template and the truth come in.
 */
import { FrameRate, isNotGraphic, RationalTime, type Template } from '@taalcut/core';
import { defaultPresetFor } from '@taalcut/render';
import { scoreGraphics, type GraphicsScore } from './graphics';
import type { Truth } from './schema';

/** A cut this many frames from a true one is that cut (eval FORMAT: within 2 frames). */
const CUT_TOLERANCE = 2;
/** A downbeat this close to a true one, in milliseconds, is that downbeat (an eighth of a beat at 105 BPM). */
const DOWNBEAT_MS = 70;
/** A slot this short inside a fade is its tail. */
const TAIL_SECONDS = 0.5;

export interface TruthScore {
  readonly cuts: {
    readonly truth: number;
    readonly found: number;
    readonly missed: number[];
    readonly false: number[];
    readonly notCutsHit: number;
  };
  readonly fadeTailSlot: boolean;
  readonly overlays: {
    readonly truth: number;
    readonly kept: number;
    readonly keptMarked: number;
    readonly sceneKept: number;
    readonly sceneMarked: number;
    /** Scene text kept without a doubt and not removed by its graphic brief: it would reach a made video. */
    readonly sceneUnmarked: number;
    /** DSG1-READ: true overlays the graphic reading calls footage, so made videos leave them out. */
    readonly keptRemoved: number;
    /** DSG1-READ: scene text the graphic reading removed. */
    readonly sceneRemoved: number;
  };
  /** DSG1-READ: the graphic reading against the truth; null without one. */
  readonly graphics: GraphicsScore | null;
  readonly intents: {
    readonly slots: number;
    readonly withSubject: number;
    readonly cameraMotionFair: number;
    readonly staticWhenMoving: number;
    readonly duplicates: number;
  };
  readonly speech: { readonly segments: number; readonly hallucinated: number };
  readonly tempo: { readonly bpm: number | null; readonly errorPercent: number | null };
  readonly downbeats: {
    readonly truth: number;
    readonly matched: number;
    readonly extra: number;
    readonly beatsPerBar: number | null;
  };
  readonly orientation: {
    readonly canvas: string;
    readonly defaultPreset: string;
    readonly matches: boolean;
  };
  readonly doubts: {
    readonly template: string[];
    readonly expectedMissing: string[];
    readonly slots: Record<string, number>;
    readonly text: number;
  };
}

const overlap = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
const spanIou = (a: readonly [number, number], b: readonly [number, number]) => {
  const inter = overlap(a, b);
  return inter / Math.max(1, a[1] - a[0] + b[1] - b[0] - inter);
};
const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export function scoreTemplate(template: Template, truth: Truth): TruthScore {
  const rate = FrameRate.of(truth.frameRate.numerator, truth.frameRate.denominator);
  const toFrame = (time: RationalTime) => RationalTime.toFrames(time, rate, 'round');
  const slots = template.slots.map((slot) => ({
    slot,
    start: toFrame(slot.start),
    end: toFrame(slot.start) + toFrame(slot.duration),
  }));

  // Cuts: every slot start but the first, against the true cuts.
  const found = slots.slice(1).map((slot) => slot.start);
  const near = (a: number, b: number) => Math.abs(a - b) <= CUT_TOLERANCE;
  const missed = truth.cuts.filter((cut) => !found.some((frame) => near(frame, cut)));
  const falseCuts = found.filter((frame) => !truth.cuts.some((cut) => near(frame, cut)));
  const notCutsHit = falseCuts.filter((frame) =>
    truth.notCuts.some((not) =>
      not.frame !== undefined
        ? near(frame, not.frame)
        : not.frameRange
          ? frame >= not.frameRange[0] && frame <= not.frameRange[1]
          : false,
    ),
  ).length;

  // The fade's tail: a short slot that starts inside a fade.
  const fadeTailSlot = slots.some(
    (slot) =>
      slot.start > 0 &&
      truth.transitions.some(
        (fade) => fade.kind === 'fade' && slot.start > fade.startFrame && slot.start <= fade.endFrame + 1,
      ) &&
      (slot.end - slot.start) / FrameRate.toNumber(rate) < TAIL_SECONDS,
  );

  // Overlays: a kept one is a true overlay when its time and words match one.
  const matches = (overlay: Template['text'][number], text: string) =>
    fold(text) === fold(overlay.text) || fold(text).includes(fold(overlay.text));
  const matchOf = (overlay: Template['text'][number]) => {
    const start = toFrame(overlay.start);
    const span = [start, start + toFrame(overlay.duration)] as const;
    return truth.overlays.findIndex(
      (real) => spanIou(span, [real.startFrame, real.endFrame]) >= 0.5 && matches(overlay, real.text),
    );
  };
  const isTrue = (overlay: Template['text'][number]) => matchOf(overlay) >= 0;
  const marked = (overlay: Template['text'][number]) =>
    (overlay.doubts ?? []).some((doubt) => doubt.reason === 'textMaybeScene');
  const removed = (overlay: Template['text'][number]) => isNotGraphic(template.graphics, overlay.id);
  const real = template.text.filter(isTrue);
  const scene = template.text.filter((overlay) => !isTrue(overlay));

  // Intents: each slot against the true shot it starts in.
  const shotOf = (frame: number) =>
    truth.shots.find((shot) => frame >= shot.startFrame && frame < shot.endFrame) ?? truth.shots.at(-1)!;
  const texts = slots.map(({ slot }) => fold(slot.intent.text));
  let withSubject = 0;
  let cameraMotionFair = 0;
  let staticWhenMoving = 0;
  for (const { slot, start } of slots) {
    const shot = shotOf(start);
    const words = fold(`${slot.intent.subject ?? ''} ${slot.intent.text}`).split(/[^\p{L}\p{N}-]+/u);
    if (shot.subjectWords.some((word) => words.includes(fold(word)))) withSubject += 1;
    if (slot.intent.motion !== null && shot.cameraMotions.includes(slot.intent.motion)) cameraMotionFair += 1;
    if (!shot.static && slot.intent.motion === 'static') staticWhenMoving += 1;
  }
  const duplicates = texts.filter((text, i) => texts.indexOf(text) !== i).length;

  // Speech, tempo and downbeats.
  const segments = template.audio.speech?.segments.length ?? 0;
  const bpm = template.beatMap?.bpm ?? null;
  const beatMs = (template.beatMap?.beats ?? []).map((beat) => RationalTime.toSeconds(beat) * 1000);
  const downMs = (template.beatMap?.downbeats ?? [])
    .map((index) => beatMs[index]!)
    .filter((ms) => ms !== undefined);
  const matchedDown = truth.tempo.downbeatsMs.filter((ms) =>
    downMs.some((at) => Math.abs(at - ms) <= DOWNBEAT_MS),
  );
  const extraDown = downMs.filter(
    (at) => !truth.tempo.downbeatsMs.some((ms) => Math.abs(at - ms) <= DOWNBEAT_MS),
  );

  // Orientation: the preset an export uses while nobody has chosen one.
  const preset = defaultPresetFor(template.canvas);
  const landscapePreset = preset === 'landscape' || preset === 'standard';
  const wantLandscape = truth.source.orientation === 'landscape';

  const reelDoubts = (template.doubts ?? []).map((doubt) => doubt.reason as string);
  const slotDoubts: Record<string, number> = {};
  for (const { slot } of slots)
    for (const doubt of slot.doubts ?? []) slotDoubts[doubt.reason] = (slotDoubts[doubt.reason] ?? 0) + 1;

  return {
    cuts: {
      truth: truth.cuts.length,
      found: truth.cuts.length - missed.length,
      missed,
      false: falseCuts,
      notCutsHit,
    },
    fadeTailSlot,
    overlays: {
      truth: truth.overlays.length,
      kept: real.length,
      keptMarked: real.filter(marked).length,
      sceneKept: scene.length,
      sceneMarked: scene.filter(marked).length,
      sceneUnmarked: scene.filter((overlay) => !marked(overlay) && !removed(overlay)).length,
      keptRemoved: real.filter(removed).length,
      sceneRemoved: scene.filter(removed).length,
    },
    graphics: scoreGraphics(template, truth, matchOf, matches),
    intents: { slots: slots.length, withSubject, cameraMotionFair, staticWhenMoving, duplicates },
    speech: { segments, hallucinated: truth.speech.present ? 0 : segments },
    tempo: {
      bpm,
      errorPercent:
        bpm === null ? null : Math.round(((bpm - truth.tempo.bpm) / truth.tempo.bpm) * 10_000) / 100,
    },
    downbeats: {
      truth: truth.tempo.downbeatsMs.length,
      matched: matchedDown.length,
      extra: extraDown.length,
      beatsPerBar: template.beatMap?.beatsPerBar ?? null,
    },
    orientation: {
      canvas: `${template.canvas.width}x${template.canvas.height}`,
      defaultPreset: preset,
      matches: landscapePreset === wantLandscape,
    },
    doubts: {
      template: reelDoubts,
      expectedMissing: truth.expectedDoubts.template.filter((reason) => !reelDoubts.includes(reason)),
      slots: slotDoubts,
      text: template.text.filter(marked).length,
    },
  };
}
