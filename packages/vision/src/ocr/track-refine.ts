// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Edge refinement for on-screen text tracks: a text's first and last frames
 * lie between two samples, so a few single-frame OCR reads bisect the gap
 * (the second method for text timing). At most `refineCallsPerEdge` reads per
 * edge; 4 fps on a 30 fps grid leaves a 7–8 frame gap, which 3 reads close to
 * one frame.
 *
 * Every edge of a shot bisects in lockstep (IX-O4): each round reads the
 * middle frame of every open edge in one batch, and edges that share a gap
 * (several texts that appeared in the same sample) share its reads. Each
 * edge sees exactly the frames it would have read alone, so the result is the
 * same as bisecting edge by edge, with one frame read (and one decode run)
 * per distinct frame and round instead of per edge. An edge with a `probe`
 * (a shot's cut frame) reads it in a round before the bisection: when the
 * text is there, the edge is placed with that one read.
 */
import { CancelledError, err, ok, type AsyncResult, type NormalisedBox } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { sameCounter } from './counter-text';
import { boxIou, textSimilarity } from './text';
import type { OcrPage } from './types';

/** OCR several frames at once: one page per frame, any order. */
export type OcrFrames = (frames: readonly number[], signal?: AbortSignal) => AsyncResult<OcrPage[]>;

/** Whether the page shows this text in about this place (a counter: any counter reading in its place). */
export function pageShows(page: OcrPage, text: string, box: NormalisedBox, counter = false): boolean {
  const { trackIou, trackSimilarity, minConfidence } = VISION_CONFIG.ocr;
  return page.observations.some(
    (o) =>
      o.confidence >= minConfidence &&
      ((boxIou(o.box, box) >= trackIou && textSimilarity(o.text, text) >= trackSimilarity) ||
        (counter && sameCounter(o, { text, box }))),
  );
}

export interface EdgeSearch {
  /** A frame known not to show the text (or −1 / the end: nothing to read there). */
  readonly absent: number;
  /** A frame known to show it. */
  readonly present: number;
  readonly text: string;
  readonly box: NormalisedBox;
  /** The text is a counter that ticks in place: any counter reading in its place shows it. */
  readonly counter?: boolean;
  /** A frame to read before bisecting (the shot's cut frame on this side). */
  readonly probe?: number;
}

export interface EdgeResult {
  /** The frame nearest the boundary known to show the text. */
  readonly frame: number;
  /** Frames found to show it besides `present`. */
  readonly confirmed: number;
  /** Reads this edge looked at (shared reads count for every edge that used them). */
  readonly calls: number;
}

interface EdgeState {
  absent: number;
  present: number;
  confirmed: number;
  calls: number;
}

/**
 * The frames a round reads, each with the edges it decides. Round −1 reads the probes only; the bisection rounds
 * read every open edge's middle frame.
 */
function roundFrames(
  state: readonly EdgeState[],
  searches: readonly EdgeSearch[],
  round: number,
): Map<number, number[]> {
  const wanted = new Map<number, number[]>();
  state.forEach((edge, i) => {
    if (Math.abs(edge.present - edge.absent) <= 1) return;
    const probe = searches[i]?.probe;
    if (round < 0 && probe === undefined) return;
    const frame = probe !== undefined && round < 0 ? probe : Math.trunc((edge.absent + edge.present) / 2);
    wanted.set(frame, [...(wanted.get(frame) ?? []), i]);
  });
  return wanted;
}

/** Moves each edge the page decides to the page's frame, on the side the page shows. */
function settle(
  page: OcrPage,
  edges: readonly number[],
  state: EdgeState[],
  searches: readonly EdgeSearch[],
) {
  for (const i of edges) {
    const edge = state[i];
    const search = searches[i];
    if (!edge || !search) continue;
    edge.calls++;
    if (pageShows(page, search.text, search.box, search.counter)) {
      edge.present = page.frame;
      edge.confirmed++;
    } else {
      edge.absent = page.frame;
    }
  }
}

/**
 * Narrows every edge's boundary between `absent` and `present` by bisection,
 * all edges in lockstep. `onRead` hears how many distinct frames each round
 * read.
 */
export async function refineEdges(
  searches: readonly EdgeSearch[],
  read: OcrFrames | undefined,
  signal: AbortSignal | undefined,
  onRead?: (frames: number) => void,
): AsyncResult<EdgeResult[]> {
  const state: EdgeState[] = searches.map((s) => ({
    absent: s.absent,
    present: s.present,
    confirmed: 0,
    calls: 0,
  }));
  for (let round = -1; read && round < VISION_CONFIG.ocr.refineCallsPerEdge; round++) {
    const wanted = roundFrames(state, searches, round);
    if (wanted.size === 0 && round < 0) continue;
    if (wanted.size === 0) break;
    if (signal?.aborted) return err(CancelledError());
    const frames = [...wanted.keys()].sort((a, b) => a - b);
    const pages = await read(frames, signal);
    onRead?.(frames.length);
    if (!pages.ok) return pages;
    const byFrame = new Map(pages.value.map((page) => [page.frame, page]));
    for (const [frame, edges] of wanted)
      settle(byFrame.get(frame) ?? { frame, observations: [] }, edges, state, searches);
  }
  return ok(state.map((edge) => ({ frame: edge.present, confirmed: edge.confirmed, calls: edge.calls })));
}
