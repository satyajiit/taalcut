// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: what is measured about a reel's overlay, in words a designer uses: its look (BRK1-GFX's design), how it
 * comes and goes, how long its typing dots ran, what its entrance is timed to (a cut, a beat, a line of speech), and
 * where it sits relative to the reel's people (FRM1-OVL). These are facts: the prompt gives them to the model as true,
 * and the brief keeps them whatever the model says. Pure.
 */
import {
  RationalTime,
  type FrameRate,
  type OverlayPlacement,
  type ReelSubjects,
  type Template,
  type TextOverlay,
} from '@taalcut/core';
import { beatFrames } from '../../edits/timing';
import type { BreakdownDraft } from '../draft';
import { relationIn } from '../overlay-relation';
import type { DraftTextRegion } from '../text-judge';
import { colourWords } from './colour-words';
import { textRecord, type TextRecord } from './record';

/** What the facts are read from: a breakdown's draft or a built template, the same way. */
export interface GraphicReel {
  readonly rate: FrameRate;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly text: readonly TextOverlay[];
  /** Frames. */
  readonly beats: readonly number[];
  readonly cuts: readonly number[];
  readonly speech: readonly { readonly start: number; readonly end: number; readonly text: string }[];
  readonly subjects?: ReelSubjects | undefined;
  /** FIX-SIGN's record of each reading (the draft's; a built template has none of its own). */
  readonly textRegions?: readonly DraftTextRegion[] | undefined;
}

export const GRAPHIC_TIMING = {
  /** An entrance this close to a cut or a beat (frames) is timed to it. */
  frames: 2,
  /** An entrance this soon after a line of speech ends (seconds) follows it. */
  afterSpeech: 0.6,
} as const;

const toFrame = (time: RationalTime, rate: FrameRate) => RationalTime.toFrames(time, rate, 'round');

function speechOf(
  segments: NonNullable<BreakdownDraft['audio']['speech']>['segments'] | undefined,
  rate: FrameRate,
) {
  return (segments ?? []).map((segment) => ({
    start: toFrame(segment.start, rate),
    end: toFrame(segment.start, rate) + toFrame(segment.duration, rate),
    text: segment.text,
  }));
}

export function reelOfDraft(draft: BreakdownDraft): GraphicReel {
  const rate = draft.canvas.rate;
  return {
    rate,
    canvas: draft.canvas,
    text: draft.text,
    beats: beatFrames(draft.beatMap, rate),
    cuts: [
      ...draft.cuts.map((cut) => cut.frame),
      ...draft.disputes.filter((d) => d.ruleKeeps).map((d) => d.frame),
    ],
    speech: speechOf(draft.audio.speech?.segments, rate),
    subjects: draft.subjects,
    textRegions: draft.textRegions,
  };
}

export function reelOfTemplate(template: Template): GraphicReel {
  const rate = template.canvas.rate;
  return {
    rate,
    canvas: template.canvas,
    text: template.text,
    beats: beatFrames(template.beatMap, rate),
    cuts: template.slots.slice(1).map((slot) => toFrame(slot.start, rate)),
    speech: speechOf(template.audio.speech?.segments, rate),
    subjects: template.subjects,
  };
}

export interface GraphicFacts {
  readonly start: number;
  readonly end: number;
  readonly seconds: { readonly start: number; readonly end: number };
  /** The measured look in words; null for text with no design read. */
  readonly look: string | null;
  readonly motion: string;
  readonly typingSeconds: number | null;
  readonly timing: { readonly cue: 'beat' | 'speech' | 'cut' | 'free'; readonly words: string };
  readonly people: string;
  readonly placement: OverlayPlacement | null;
  /** The text stage doubted it: it comes and goes with its shot, as scene text does. */
  readonly sceneDoubt: boolean;
  /** FIX-SIGN's fused evidence on it: composited, the scene's or unsure; null before FIX-SIGN. */
  readonly record: TextRecord | null;
  readonly crossesCut: boolean;
}

const ENTER: Record<NonNullable<TextOverlay['design']>['motion']['enter'], string> = {
  none: 'cuts in',
  fade: 'fades in',
  pop: 'pops in',
  slide: 'slides in',
  typewriter: 'types on letter by letter',
  wordByWord: 'comes on word by word',
  unknown: "comes on (how, the reel's frames can't tell)",
};
const EXIT: Record<NonNullable<TextOverlay['design']>['motion']['exit'], string> = {
  none: 'cuts out',
  fade: 'fades out',
  pop: 'pops out',
  slide: 'slides out',
  unknown: "goes (how, the reel's frames can't tell)",
};
const SHAPE: Partial<Record<NonNullable<TextOverlay['design']>['kind'], string>> = {
  chatBubble: 'bubble',
  pill: 'pill',
  label: 'box',
  lowerThird: 'band',
  sticker: 'sticker',
  callout: 'callout',
  cta: 'button',
};

/** The measured look in words: "a white (#f7f5f9) bubble with a tail at the bottom right, read ticks, …". */
export function lookWords(design: TextOverlay['design']): string | null {
  if (!design) return null;
  const type = `${colourWords(design.colors.text)} (${design.colors.text}) ${design.font.weight >= 600 ? 'bold' : 'regular'} sans type`;
  if (!design.colors.fill || design.kind === 'plain') return `words with no shape behind them, ${type}`;
  const shape = SHAPE[design.kind] ?? 'shape';
  const corners =
    design.cornerRadius >= 0.42 ? 'round-ended' : design.cornerRadius >= 0.15 ? 'rounded' : 'square';
  const parts = [`a ${corners} ${colourWords(design.colors.fill)} (${design.colors.fill}) ${shape}`];
  if (design.tail !== 'none') parts.push(`a tail at the bottom ${design.tail}`);
  if (design.receipt) parts.push('read ticks');
  parts.push(type);
  return parts.join(', ');
}

function motionWords(overlay: TextOverlay, typingSeconds: number | null): string {
  const design = overlay.design;
  const enter = design
    ? ENTER[design.motion.enter]
    : overlay.reveal === 'none'
      ? 'appears'
      : ENTER[overlay.reveal];
  const exit = design ? EXIT[design.motion.exit] : 'goes';
  const typing = typingSeconds !== null ? `typing dots for about ${typingSeconds} s, then the words; ` : '';
  return `${typing}${enter}, ${exit}`;
}

function timingOf(reel: GraphicReel, start: number): GraphicFacts['timing'] {
  const near = (frames: readonly number[]) =>
    frames.some((frame) => Math.abs(frame - start) <= GRAPHIC_TIMING.frames);
  if (near(reel.cuts)) return { cue: 'cut', words: 'comes on at a cut' };
  if (near(reel.beats)) return { cue: 'beat', words: 'comes on on a beat' };
  const fps = RationalTime.toFrames(RationalTime.fromSeconds(1, reel.rate), reel.rate);
  const line = reel.speech.find(
    (segment) => start >= segment.end - fps * 0.3 && start - segment.end <= fps * GRAPHIC_TIMING.afterSpeech,
  );
  if (line)
    return { cue: 'speech', words: `comes on right after the line "${line.text.trim().slice(0, 80)}"` };
  return { cue: 'free', words: 'not timed to a cut, a beat or speech' };
}

const ZONE = { top: 'the top third', middle: 'the middle', bottom: 'the bottom third' } as const;
const SIDE = {
  left: "to the left of the person's head",
  right: "to the right of the person's head",
  above: "above the person's head",
  below: "below the person's head",
} as const;

function peopleWords(placement: OverlayPlacement | null, box: TextOverlay['box'], subjects: boolean): string {
  if (placement?.relativeTo === 'subject' && placement.side)
    return `${SIDE[placement.side]}, clear of their face`;
  const middle = box.y + box.height / 2;
  const zone = placement?.zone ?? (middle < 1 / 3 ? 'top' : middle < 2 / 3 ? 'middle' : 'bottom');
  return subjects
    ? `in ${ZONE[zone]} of the frame, away from the people`
    : `in ${ZONE[zone]} of the frame (no people were measured)`;
}

/** The facts of one overlay of the reel. `lead`: frames its shape showed before its words, when measured. */
export function graphicFacts(reel: GraphicReel, overlay: TextOverlay, lead?: number): GraphicFacts {
  const start = toFrame(overlay.start, reel.rate);
  const end = start + Math.max(1, toFrame(overlay.duration, reel.rate));
  const seconds = (frame: number) => Math.round(((frame * reel.rate.den) / reel.rate.num) * 100) / 100;
  const typingSeconds =
    overlay.design?.motion.typing && lead && lead > 0 ? Math.round(seconds(lead) * 10) / 10 : null;
  const placement = overlay.design?.placement ?? relationIn(overlay, reel.subjects, reel.canvas);
  return {
    start,
    end,
    seconds: { start: seconds(start), end: seconds(end) },
    look: lookWords(overlay.design),
    motion: motionWords(overlay, typingSeconds),
    typingSeconds,
    timing: timingOf(reel, start),
    people: peopleWords(
      placement,
      overlay.design?.shape ?? overlay.box,
      (reel.subjects?.samples.length ?? 0) > 0,
    ),
    placement,
    sceneDoubt: overlay.doubts?.some((doubt) => doubt.reason === 'textMaybeScene') ?? false,
    record: textRecord(reel.textRegions, overlay.id),
    crossesCut: reel.cuts.some((cut) => cut > start && cut < end),
  };
}
