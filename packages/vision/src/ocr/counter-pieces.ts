// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A counter read in pieces (FIX-CLOCK, IX-O4). Since macOS 27.2, Vision reads
 * a running clock in some samples as two or three observations on its line
 * ("00:00:" and "000", the "03." between them dropped), where earlier macOS
 * read one. Each piece is a counter in the clock's place, so each opened a
 * track of its own and the clock was stored as several texts. Before
 * tracking, a page's counter readings on one line become one reading, its box
 * around them all, when they sit side by side (at most `counterPieceGap` of
 * their characters apart) or when the box a counter was last read in holds
 * both. Only counters join: the words beside a score ("HOME", "AWAY") stay
 * their own texts, and so do counters on other lines or further apart.
 */
import { overlapArea, type NormalisedBox } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { isCounter } from './counter-text';
import { boxArea, boxUnion, normaliseText, scriptOf } from './text';
import type { OcrObservation } from './types';

/** The boxes share a line: they overlap down by `counterPieceLine` of the shorter, and are of a height. */
function oneLine(a: NormalisedBox, b: NormalisedBox): boolean {
  const { counterPieceLine, counterPieceHeights } = VISION_CONFIG.ocr;
  const shorter = Math.min(a.height, b.height);
  const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return (
    shorter > 0 &&
    Math.max(a.height, b.height) <= shorter * counterPieceHeights &&
    down >= shorter * counterPieceLine
  );
}

/** One character's width in the reading (the frame's aspect is unknown here, so gaps are measured in these). */
function charWidth(observation: OcrObservation): number {
  return observation.box.width / Math.max(1, Array.from(normaliseText(observation.text)).length);
}

/** Space across between the boxes (negative where they overlap). */
function gapAcross(a: NormalisedBox, b: NormalisedBox): number {
  return Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
}

/** `whole` holds `counterContainment` of the piece. */
function holds(whole: NormalisedBox, piece: NormalisedBox): boolean {
  const area = boxArea(piece);
  return area > 0 && overlapArea(whole, piece) / area >= VISION_CONFIG.ocr.counterContainment;
}

/** Two counter readings that are pieces of one counter. */
function piecesOfOne(a: OcrObservation, b: OcrObservation, wholes: readonly NormalisedBox[]): boolean {
  if (!oneLine(a.box, b.box)) return false;
  const gap = gapAcross(a.box, b.box);
  if (gap <= VISION_CONFIG.ocr.counterPieceGap * Math.max(charWidth(a), charWidth(b))) return true;
  return wholes.some((whole) => holds(whole, a.box) && holds(whole, b.box));
}

/** The pieces, left to right, as one reading: as sure as its least sure piece. */
function join(pieces: readonly OcrObservation[]): OcrObservation {
  const sorted = [...pieces].sort((a, b) => a.box.x - b.box.x);
  const first = sorted[0]!;
  const text = normaliseText(sorted.map((piece) => piece.text).join(' '));
  return {
    text,
    box: sorted.slice(1).reduce((all, piece) => boxUnion(all, piece.box), first.box),
    confidence: Math.min(...sorted.map((piece) => piece.confidence)),
    script: scriptOf(text),
    engine: first.engine,
    ...(first.language ? { language: first.language } : {}),
  };
}

/**
 * A page's readings with each counter read in pieces joined into one, at its first piece's place; the rest as
 * they were. `wholes` are the boxes the open counter tracks were last read in.
 */
export function joinCounterPieces(
  observations: readonly OcrObservation[],
  wholes: readonly NormalisedBox[] = [],
): OcrObservation[] {
  let groups: OcrObservation[][] = [];
  const counters = observations.filter((o) => isCounter(o.text)).sort((a, b) => a.box.x - b.box.x);
  for (const counter of counters) {
    const linked = groups.filter((group) => group.some((piece) => piecesOfOne(piece, counter, wholes)));
    groups = [...groups.filter((group) => !linked.includes(group)), [...linked.flat(), counter]];
  }
  const joined = groups.filter((group) => group.length > 1);
  if (joined.length === 0) return [...observations];
  const groupOf = new Map(joined.flatMap((group) => group.map((piece) => [piece, group] as const)));
  const out: OcrObservation[] = [];
  const done = new Set<OcrObservation[]>();
  for (const observation of observations) {
    const group = groupOf.get(observation);
    if (!group) out.push(observation);
    else if (!done.has(group)) {
      done.add(group);
      out.push(join(group));
    }
  }
  return out;
}
