// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text that replaces itself in place (LYR1): a lyric shown one word at a time, captions line after line. Each piece
 * shows briefly at one place, in one size, and the next starts where it ends, with other words. The owner's reel
 * showed nine words this way across three shots; the breakdown kept three scraps of them and the made video showed
 * one block of wrong words for six seconds.
 *
 * One rule, used on the breakdown's readings (text-sites.ts, text-zone.ts) and on a template's stored overlays (the
 * timeline's tools, the tools' summaries), so the make keeps the cadence the breakdown found:
 *
 * - **a chain**: pieces of one place and one size, each short, each starting within a few frames of the last one's
 *   end, each with words that are not the last one's;
 * - **replacing**: a chain of `minMembers` or more whose links are mostly between unrelated words, and that changes
 *   at least once away from a cut or keeps a piece across one. Scenery never does this: a sign read three ways is
 *   alike words, and signs in shot after shot change only at the cuts.
 *
 * Pure: frames in, indices out.
 */
import {
  RationalTime,
  type Box,
  type FrameRate,
  type Template,
  type TextOverlay,
  type TextOverlayId,
} from '@taalcut/core';
import { BREAKDOWN_CONFIG } from './config';
import { normaliseText, textSimilarity } from './text-track';

/** The rule's edges, in frames (`sequenceRuleFor` makes them from the config's seconds). */
export interface SequenceRule {
  /** The next piece starts within this many frames of the last one's end, before or after. */
  readonly gapFrames: number;
  /** A piece lasts at most this long. */
  readonly maxFrames: number;
  /** The taller of two pieces is at most this many times the shorter. */
  readonly sizeRatio: number;
  /** Pieces a chain needs before it is evidence of editing. */
  readonly minMembers: number;
}

/** One piece of text with its place and its frames, [start, end). */
export interface PlacedText {
  readonly text: string;
  readonly box: Box;
  readonly start: number;
  readonly end: number;
}

export interface TextChain {
  /** Indices into the pieces given, in the order they show. */
  readonly members: readonly number[];
  readonly start: number;
  readonly end: number;
  /** Where its words show: the union of its members' boxes. */
  readonly zone: Box;
}

/** Readings this alike are one text read differently (text-sites.ts's floor). */
const ALIKE = 0.4;
/** The tracker's "same line": a piece never follows itself. */
const SAME = 0.85;

const centreY = (box: Box) => box.y + box.height / 2;

/** One place: on one line, and one's width mostly inside the other's (centred or anchored words of any length). */
export function onePlace(a: Box, b: Box): boolean {
  const tall = Math.max(a.height, b.height);
  if (Math.abs(centreY(a) - centreY(b)) > tall * 0.5) return false;
  const shared = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return shared >= Math.min(a.width, b.width) * 0.5;
}

/** One size: the line heights within the rule's ratio. */
export function oneSize(a: Box, b: Box, ratio: number): boolean {
  const small = Math.min(a.height, b.height);
  return small > 0 && Math.max(a.height, b.height) / small <= ratio;
}

/** The same words read twice. Words that could not be read (nothing left once normalised) are never the same. */
function sameWords(a: string, b: string): boolean {
  return normaliseText(a).length > 0 && normaliseText(b).length > 0 && textSimilarity(a, b) >= SAME;
}

/** `next` takes over from `last`: where it ended, in its place and size, with other words. */
export function follows(last: PlacedText, next: PlacedText, rule: SequenceRule): boolean {
  return (
    next.start > last.start &&
    next.end > last.end &&
    Math.abs(next.start - last.end) <= rule.gapFrames &&
    onePlace(last.box, next.box) &&
    oneSize(last.box, next.box, rule.sizeRatio) &&
    !sameWords(last.text, next.text)
  );
}

export function unionBox(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Every chain of two or more among `pieces`, in the order they start. Each piece joins the chain whose last piece
 * it follows most closely, or starts one; a piece longer than the rule allows joins none.
 */
export function textChains(pieces: readonly PlacedText[], rule: SequenceRule): TextChain[] {
  const order = pieces
    .map((_, index) => index)
    .filter((index) => pieces[index]!.end - pieces[index]!.start <= rule.maxFrames)
    .sort((a, b) => pieces[a]!.start - pieces[b]!.start || pieces[a]!.end - pieces[b]!.end);
  const chains: number[][] = [];
  for (const index of order) {
    const piece = pieces[index]!;
    let best: number[] | undefined;
    for (const chain of chains) {
      const last = pieces[chain[chain.length - 1]!]!;
      if (!follows(last, piece, rule)) continue;
      const bestLast = best && pieces[best[best.length - 1]!]!;
      if (!bestLast || Math.abs(piece.start - last.end) < Math.abs(piece.start - bestLast.end)) best = chain;
    }
    if (best) best.push(index);
    else chains.push([index]);
  }
  return chains
    .filter((chain) => chain.length >= 2)
    .map((members) => ({
      members,
      start: pieces[members[0]!]!.start,
      end: Math.max(...members.map((index) => pieces[index]!.end)),
      zone: unionBox(members.map((index) => pieces[index]!.box)),
    }));
}

/**
 * Whether a chain is text replacing itself, which only editing does: enough pieces, most links between unrelated
 * words, and a change away from every cut or a piece kept across one. `cuts` are the frames shots start at; `near`
 * is how close to a cut still counts as at it.
 */
export function isReplacing(
  chain: TextChain,
  pieces: readonly PlacedText[],
  options: { readonly cuts: readonly number[]; readonly near: number; readonly rule: SequenceRule },
): boolean {
  const { cuts, near, rule } = options;
  const members = chain.members.map((index) => pieces[index]!);
  if (members.length < rule.minMembers) return false;
  const links = members.slice(1).map((next, at) => ({ last: members[at]!, next }));
  const unrelated = links.filter(({ last, next }) => textSimilarity(last.text, next.text) < ALIKE).length;
  if (unrelated * 2 < links.length) return false;
  const atCut = (frame: number) => cuts.some((cut) => Math.abs(cut - frame) <= near);
  const changesMidShot = links.some(({ next }) => !atCut(next.start));
  const crossesCut = members.some((piece) =>
    cuts.some((cut) => cut - piece.start > near && piece.end - cut > near),
  );
  return changesMidShot || crossesCut;
}

/** Text replacing itself among `pieces`, with what else was read in its place while it showed. */
export interface ReplacingText {
  readonly chain: TextChain;
  /**
   * Pieces that are not its own but lie in its place during its time: scraps of the picture behind its words, or of
   * the words themselves. Whatever they are, they are not overlays of their own.
   */
  readonly noise: readonly number[];
}

/** The share of `box` inside `zone`. */
function shareInside(box: Box, zone: Box): number {
  const x = Math.min(box.x + box.width, zone.x + zone.width) - Math.max(box.x, zone.x);
  const y = Math.min(box.y + box.height, zone.y + zone.height) - Math.max(box.y, zone.y);
  const area = box.width * box.height;
  return area > 0 && x > 0 && y > 0 ? (x * y) / area : 0;
}

/**
 * Every chain among `pieces` that is text replacing itself (`isReplacing`), each with its noise: the other pieces
 * that show only while it does and lie mostly inside its place, grown by half a line (a scrap read at the words' edge
 * is still theirs).
 */
export function replacingTexts(
  pieces: readonly PlacedText[],
  options: { readonly cuts: readonly number[]; readonly near: number; readonly rule: SequenceRule },
): ReplacingText[] {
  const { rule } = options;
  const chains = textChains(pieces, rule).filter((chain) => isReplacing(chain, pieces, options));
  const own = new Set(chains.flatMap((chain) => chain.members));
  return chains.map((chain) => {
    const heights = chain.members.map((index) => pieces[index]!.box.height).sort((a, b) => a - b);
    const half = (heights[heights.length >> 1] ?? 0) / 2;
    const { zone } = chain;
    const place = {
      x: zone.x - half,
      y: zone.y - half,
      width: zone.width + half * 2,
      height: zone.height + half * 2,
    };
    const noise = pieces.flatMap((piece, index) =>
      !own.has(index) &&
      piece.start >= chain.start - rule.gapFrames &&
      piece.end <= chain.end + rule.gapFrames &&
      shareInside(piece.box, place) >= 0.6
        ? [index]
        : [],
    );
    return { chain, noise };
  });
}

/** The rule in frames at `rate`, from the config's seconds. */
export function sequenceRuleFor(
  config: {
    readonly gapSeconds: number;
    readonly maxSeconds: number;
    readonly sizeRatio: number;
    readonly minMembers: number;
  },
  rate: FrameRate,
): SequenceRule {
  const fps = rate.num / rate.den;
  return {
    gapFrames: Math.max(1, Math.round(config.gapSeconds * fps)),
    maxFrames: Math.max(1, Math.round(config.maxSeconds * fps)),
    sizeRatio: config.sizeRatio,
    minMembers: config.minMembers,
  };
}

/** A sequence among a template's (or a timeline's) stored texts. */
export interface TextSequence {
  /** Its texts' ids, in the order they show. */
  readonly ids: readonly TextOverlayId[];
  /** Frames at the rate given, [start, end). */
  readonly start: number;
  readonly end: number;
  /** Each text's frames, in order. */
  readonly frames: readonly number[];
  readonly zone: Box;
}

/**
 * The sequences among stored overlays: every chain of two or more. The overlays were judged added text when the
 * template was made, so a chain needs no further proof here.
 */
export function textSequences(
  overlays: readonly Pick<TextOverlay, 'id' | 'text' | 'box' | 'start' | 'duration'>[],
  rate: FrameRate,
  rule: SequenceRule,
): TextSequence[] {
  const pieces = overlays.map((overlay) => {
    const start = RationalTime.toFrames(overlay.start, rate, 'round');
    return {
      text: overlay.text,
      box: overlay.box,
      start,
      end: start + Math.max(1, RationalTime.toFrames(overlay.duration, rate, 'round')),
    };
  });
  return textChains(pieces, rule).map((chain) => ({
    ids: chain.members.map((index) => overlays[index]!.id),
    start: chain.start,
    end: chain.end,
    frames: chain.members.map((index) => pieces[index]!.end - pieces[index]!.start),
    zone: chain.zone,
  }));
}

/** A template's sequences, by the breakdown's own rule at the template's rate. */
export function templateTextSequences(template: Pick<Template, 'text' | 'canvas'>): TextSequence[] {
  const { rate } = template.canvas;
  return textSequences(template.text, rate, sequenceRuleFor(BREAKDOWN_CONFIG.textScene.sequence, rate));
}

/** A sequence in plain words, for a tool's summary: "a 9-text sequence, one at a time, 0.33–5.10 s (about 0.5 s each)". */
export function sequenceWords(sequence: TextSequence, rate: FrameRate): string {
  const seconds = (frames: number) => ((frames * rate.den) / rate.num).toFixed(2);
  const each = sequence.frames.reduce((sum, frames) => sum + frames, 0) / Math.max(1, sequence.frames.length);
  return (
    `a ${sequence.ids.length}-text sequence, one at a time, ${seconds(sequence.start)}–${seconds(sequence.end)} s ` +
    `(about ${((each * rate.den) / rate.num).toFixed(1)} s each)`
  );
}
