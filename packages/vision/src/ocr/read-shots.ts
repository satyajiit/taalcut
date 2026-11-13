// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text for every shot of an asset (IX-O5, IX-O6). Each shot reads a
 * sample a second on the asset's one-second grid (the frames the analysis pass
 * keeps), or its best frame (else its middle frame) when no sample falls
 * inside it, as vision.analyse did. Shots are read in windows of about
 * `window` samples, so the engine gets full requests (and can keep several in
 * flight) even when shots are short: unchanged frames reuse a page within
 * their own shot, and the rest go in one engine call.
 *
 * Indexing's text is sample-grain (IX-O5, approved 2026-10-17): nothing reads
 * more than the samples. A text starts on the first sample that shows it and
 * ends one frame after the last, so each end is at most one sample short. Each
 * shot's texts are then cleaned (clean.ts, LIB1-FIX): a text seen in one sample
 * is kept unless it is junk, reads of one phrase are one text spanning every
 * sample that showed it, and lines read together are one block. Search, the
 * agent's tool, the clip profile and the text vectors read only the words. A
 * consumer that needs exact edges refines them on demand, as the breakdown
 * does (`trackOnScreenText` with a frame reader, never cleaned).
 */
import { CancelledError, err, ok, type AsyncResult, type FrameRate, type OnScreenText } from '@taalcut/core';
import type { OcrMeter } from './meter';
import { cleanShotText } from './clean';
import { keepPlausible } from './plausible';
import { planReuse, readPlanned } from './reuse';
import { trackShots } from './track';
import type { OcrEngine, OcrFrame } from './types';

export interface ShotSpan {
  /** First grid frame. */
  readonly start: number;
  /** One past the last. */
  readonly end: number;
  /** The analysis's best frame: read when no sample falls inside the shot. */
  readonly bestFrame?: number;
}

export interface ReadShotsInput {
  readonly rate: FrameRate;
  readonly shots: readonly ShotSpan[];
  /** Grid frames between samples: one second. */
  readonly every: number;
  readonly languages: readonly string[];
}

export interface ReadShotsDeps {
  readonly ocr: OcrEngine;
  /** Upright RGB frames at the OCR size, one per index, in the order asked. */
  readonly frames: (indexes: readonly number[], signal?: AbortSignal) => AsyncResult<OcrFrame[]>;
  readonly meter?: OcrMeter;
}

export interface ReadShotsOptions {
  readonly signal?: AbortSignal;
  /** Samples per window (at least one shot each). Default 32: two full requests. */
  readonly window?: number;
}

/** A shot's samples: grid frames that are multiples of `every` inside it, or its best (else middle) frame. */
export function shotSamples(shot: ShotSpan, every: number): number[] {
  const frames: number[] = [];
  for (let f = Math.ceil(shot.start / every) * every; f < shot.end; f += every) frames.push(f);
  return frames.length > 0 ? frames : [shot.bestFrame ?? Math.floor((shot.start + shot.end - 1) / 2)];
}

interface WindowShot {
  readonly span: ShotSpan;
  readonly samples: number[];
}

/** The window starting at shot `first`: shots until their samples fill it (at least one shot). */
function windowAt(shots: readonly ShotSpan[], first: number, every: number, size: number): WindowShot[] {
  const window: WindowShot[] = [];
  let count = 0;
  for (
    let span = shots[first];
    span && (window.length === 0 || count < size);
    span = shots[first + window.length]
  ) {
    const samples = shotSamples(span, every);
    window.push({ span, samples });
    count += samples.length;
  }
  return window;
}

/** The window's frames split back into its shots. */
function perShot<T>(window: readonly WindowShot[], items: readonly T[]): T[][] {
  let offset = 0;
  return window.map((shot) => {
    const own = items.slice(offset, offset + shot.samples.length);
    offset += shot.samples.length;
    return own;
  });
}

/** Which frames the engine reads; reuse stays inside a shot, so a cut always reads again. */
function planWindow(window: readonly WindowShot[], frames: readonly OcrFrame[]) {
  const plans: { toRead: number[]; source: number[] } = { toRead: [], source: [] };
  let offset = 0;
  for (const own of perShot(window, frames)) {
    const plan = planReuse(own, offset);
    plans.toRead.push(...plan.toRead);
    plans.source.push(...plan.source);
    offset += own.length;
  }
  return plans;
}

/** Each shot's texts, in shot order. */
export async function readShotsText(
  input: ReadShotsInput,
  deps: ReadShotsDeps,
  options: ReadShotsOptions = {},
): AsyncResult<OnScreenText[][]> {
  const { signal } = options;
  const ocr = keepPlausible(deps.ocr);
  const withSignal = { ...(signal ? { signal } : {}), ...(deps.meter ? { meter: deps.meter } : {}) };
  const results: OnScreenText[][] = [];
  for (let first = 0; first < input.shots.length;) {
    if (signal?.aborted) return err(CancelledError());
    const window = windowAt(input.shots, first, input.every, Math.max(1, options.window ?? 32));
    first += window.length;
    const frames = await deps.frames(
      window.flatMap((shot) => shot.samples),
      signal,
    );
    if (!frames.ok) return frames;
    const plans = planWindow(window, frames.value);
    const pages = await readPlanned(ocr, frames.value, plans, { languages: input.languages, ...withSignal });
    if (!pages.ok) return pages;
    const tracked = await trackShots(
      perShot(window, pages.value).map((own, i) => ({
        rate: input.rate,
        pages: own,
        endFrame: window[i]?.span.end,
      })),
      // No frame reader: the samples' edges are the stored edges.
      undefined,
      withSignal,
    );
    if (!tracked.ok) return tracked;
    // What the shot's reads agree on: no lone junk, one text per phrase (clean.ts, LIB1-FIX).
    results.push(...tracked.value.map((texts) => cleanShotText(texts, input.every)));
  }
  return ok(results);
}
