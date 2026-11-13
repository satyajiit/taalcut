// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text tracks (SPEC "De-duplication and timing"): OCR'd samples of a
 * video become one OnScreenText per text that stays in one place. An
 * observation joins an open track when the boxes overlap (IoU ≥ 0.5) and the
 * texts agree (similarity ≥ 0.8), or when it grows the track's text in the
 * same place (a reveal). A counter read in pieces on its line joins first, as
 * one reading. A track closes after two samples without it, so one OCR
 * dropout doesn't split it. With a frame reader, edges are refined to the
 * frame by bisection; without one they stay at the samples (indexing).
 */
import {
  CancelledError,
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type FrameRate,
  type OnScreenText,
} from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { joinCounterPieces } from './counter-pieces';
import { isCounter, sameCounter } from './counter-text';
import type { OcrMeter } from './meter';
import { boxContainment, boxIou, normaliseText, textSimilarity } from './text';
import { refineEdges, type EdgeResult, type EdgeSearch, type OcrFrames } from './track-refine';
import { assembleTrack, draftTrack, type Seen, type TrackDraft } from './track-text';
import type { OcrObservation, OcrPage } from './types';

export interface TrackInput {
  /** The grid the page frames are on. */
  readonly rate: FrameRate;
  /** OCR'd samples, any order (sorted by frame here). */
  readonly pages: readonly OcrPage[];
  /** Frames on the grid (exclusive end): a text still showing at the last sample is bisected up to it. */
  readonly endFrame?: number;
  /** OCR more frames at once, for edge refinement: one decode and one request per round. Without it, edges stay at the samples. */
  readonly ocrFrames?: OcrFrames;
}

interface Track {
  readonly seen: Seen[];
  missing: number;
}

export interface TrackOptions {
  readonly signal?: AbortSignal;
  /** The job's OCR counters: tracks, flickers and refinement reads. */
  readonly meter?: OcrMeter;
}

export async function trackOnScreenText(
  input: TrackInput,
  options: TrackOptions = {},
): AsyncResult<OnScreenText[]> {
  const tracked = await trackShots([input], input.ocrFrames, options);
  return tracked.ok ? ok(tracked.value[0] ?? []) : tracked;
}

/**
 * Several shots' texts (their pages on one asset grid), every shot's edges
 * refined together: one batch of reads per bisection round for all of them.
 */
export async function trackShots(
  inputs: readonly TrackInput[],
  read: OcrFrames | undefined,
  options: TrackOptions = {},
): AsyncResult<OnScreenText[][]> {
  const shots = inputs.map((input) => {
    const pages = [...input.pages].sort((a, b) => a.frame - b.frame);
    const drafts = buildTracks(pages).flatMap((track) => draftTrack(track.seen, pages, input.endFrame) ?? []);
    return { rate: input.rate, drafts };
  });
  if (options.signal?.aborted) return err(CancelledError());
  const edges = await refineAll(
    shots.flatMap((shot) => shot.drafts),
    read,
    options,
  );
  if (!edges.ok) return edges;
  let n = 0;
  return ok(
    shots.map(({ rate, drafts }) => {
      const texts: OnScreenText[] = [];
      for (const draft of drafts) {
        const assembled = assembleTrack(draft, edges.value.start[n], edges.value.end[n], rate);
        n++;
        options.meter?.tracked(assembled.flicker);
        if (assembled.text) texts.push(assembled.text);
      }
      return texts.sort(
        (a, b) =>
          RationalTime.compare(a.range.start, b.range.start) || a.box.y - b.box.y || a.box.x - b.box.x,
      );
    }),
  );
}

/** Pages in frame order become tracks: an observation joins the open track it matches best, or opens one. */
function buildTracks(pages: readonly OcrPage[]): Track[] {
  const closed: Track[] = [];
  let open: Track[] = [];
  pages.forEach((page, sample) => {
    const matched = new Set<Track>();
    // A counter Vision read in pieces is one reading (counter-pieces.ts): its pieces don't open tracks of their own.
    const observations = joinCounterPieces(page.observations.filter(keep), counterBoxes(open)).sort(
      (a, b) => b.confidence - a.confidence,
    );
    for (const observation of observations) {
      const track = bestTrack(open, observation, matched);
      if (track) {
        track.seen.push({ sample, frame: page.frame, observation });
        track.missing = 0;
        matched.add(track);
      } else {
        const fresh: Track = { seen: [{ sample, frame: page.frame, observation }], missing: 0 };
        open.push(fresh);
        matched.add(fresh);
      }
    }
    const stillOpen: Track[] = [];
    for (const track of open) {
      if (!matched.has(track)) track.missing++;
      if (track.missing >= VISION_CONFIG.ocr.closeAfterMissing) closed.push(track);
      else stillOpen.push(track);
    }
    open = stillOpen;
  });
  return [...closed, ...open];
}

/** The boxes the open counter tracks were last read in. */
function counterBoxes(open: readonly Track[]) {
  return open.flatMap((track) => {
    const last = track.seen[track.seen.length - 1]?.observation;
    return last && isCounter(last.text) ? [last.box] : [];
  });
}

/** Every draft's start and end edges, refined together; undefined where a draft has no such edge. */
async function refineAll(
  drafts: readonly TrackDraft[],
  read: OcrFrames | undefined,
  { signal, meter }: TrackOptions,
): AsyncResult<{ start: (EdgeResult | undefined)[]; end: (EdgeResult | undefined)[] }> {
  const searches: EdgeSearch[] = [];
  const at = (search: EdgeSearch | undefined) => (search ? searches.push(search) - 1 : -1);
  const slots = drafts.map((draft) => ({ start: at(draft.start), end: at(draft.end) }));
  const refined = await refineEdges(searches, read, signal, (frames) => meter?.refined(frames));
  if (!refined.ok) return refined;
  const pick = (slot: number) => (slot >= 0 ? refined.value[slot] : undefined);
  return ok({ start: slots.map((s) => pick(s.start)), end: slots.map((s) => pick(s.end)) });
}

function keep(observation: OcrObservation): boolean {
  const { minConfidence, minChars } = VISION_CONFIG.ocr;
  return (
    observation.confidence >= minConfidence && Array.from(normaliseText(observation.text)).length >= minChars
  );
}

/** The new text extends the old one (a reveal), in the same place. */
function grows(previous: OcrObservation, next: OcrObservation): boolean {
  const before = normaliseText(previous.text);
  const after = normaliseText(next.text);
  return (
    after.length > before.length && after.startsWith(before) && boxContainment(previous.box, next.box) >= 0.8
  );
}

/** How well an observation continues a track's last one: the same text first, then a counter that ticked in place, then a reveal that grew; 0 when it doesn't. */
function continuation(last: OcrObservation, observation: OcrObservation): number {
  const { trackIou, trackSimilarity } = VISION_CONFIG.ocr;
  const iou = boxIou(last.box, observation.box);
  const similarity = textSimilarity(last.text, observation.text);
  if (iou >= trackIou && similarity >= trackSimilarity) return iou * similarity;
  if (sameCounter(last, observation)) return Math.max(iou, trackIou) * trackSimilarity * 0.99;
  return grows(last, observation) ? 0.5 : 0;
}

function bestTrack(
  open: readonly Track[],
  observation: OcrObservation,
  taken: Set<Track>,
): Track | undefined {
  let best: Track | undefined;
  let bestScore = 0;
  for (const track of open) {
    const last = track.seen[track.seen.length - 1]?.observation;
    const score = last && !taken.has(track) ? continuation(last, observation) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }
  return best;
}
