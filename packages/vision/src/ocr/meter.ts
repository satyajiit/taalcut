// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What one job's OCR did (IX-O1), so the bench can see where OCR time goes:
 * frames sampled and how many reused an earlier page, engine requests and the
 * frames and languages in them, single-frame reads for edge bisection and the
 * decodes behind every read, and each request's time split into frame
 * transfer (BMP or PNG encode and write), the request as the caller saw it, the
 * engine's own time (Vision's per-image time from the mac helper) and parsing.
 * A meter is made per job and travels in the recognize options; engines, the
 * reuse pass and the tracker add to it, and the job reports `counts()`.
 */
import { z } from 'zod';

const count = z.number().int().nonnegative();
const ms = z.number().nonnegative();

export const ocrCountsSchema = z.object({
  /** Frames the sampler asked for, before reuse. */
  sampled: count,
  /** Of those, frames that reused the page of an earlier, barely different frame. */
  reused: count,
  /** Engine requests (mac helper `ocr.recognize` calls and PP-OCR runs). */
  requests: count,
  /** Frames sent to an engine over all requests. */
  frames: count,
  /** Of the requests, those that went to PP-OCR (Devanagari), and their frames. */
  devanagariRequests: count,
  devanagariFrames: count,
  /** Languages over all requests (their mean is languages / requests), and the most in one request. */
  languages: count,
  maxLanguages: count,
  /** Frames read for edge bisection (distinct per round: edges sharing a gap share its reads). */
  refineCalls: count,
  /** Decode runs (each a seek) for the samples and for refinement. */
  sampleDecodes: count,
  refineDecodes: count,
  /** Text tracks the tracker built, and those dropped as one-sample flickers. */
  tracks: count,
  flickers: count,
  ms: z.object({
    /** Decoding frames for OCR (samples and refinement). */
    decode: ms,
    /** Frame transfer to the engine: BMP (default) or PNG encode and write. */
    encode: ms,
    /** Engine requests as the caller saw them (helper round trip; PP-OCR run). */
    request: ms,
    /** The engine's own time where it reports one (Vision, summed per image). */
    engine: ms,
    /** Validating and mapping replies. */
    parse: ms,
  }),
});

export type OcrCounts = z.infer<typeof ocrCountsSchema>;

export interface OcrRequestEntry {
  /** 'ppocr-v5' is the Devanagari model; 'ppocr-v5-latin' the Latin one (IX-O7). */
  readonly engine: 'apple-vision' | 'ppocr-v5' | 'ppocr-v5-latin';
  readonly frames: number;
  readonly languages: number;
  readonly encodeMs: number;
  readonly requestMs: number;
  /** 0 when the engine reports no time of its own. */
  readonly engineMs: number;
  readonly parseMs: number;
}

export interface OcrMeter {
  /** One batch of sampled frames, `reused` of which took an earlier page. */
  sampled(frames: number, reused: number): void;
  request(entry: OcrRequestEntry): void;
  /** A finished track, and whether it was a one-sample flicker that refinement dropped. */
  tracked(flicker: boolean): void;
  /** One round of edge bisection read this many frames. */
  refined(frames: number): void;
  /** One decode run for OCR frames. */
  decoded(purpose: 'sample' | 'refine', ms: number): void;
  counts(): OcrCounts;
}

export function createOcrMeter(): OcrMeter {
  const c: OcrCounts = {
    sampled: 0,
    reused: 0,
    requests: 0,
    frames: 0,
    devanagariRequests: 0,
    devanagariFrames: 0,
    languages: 0,
    maxLanguages: 0,
    refineCalls: 0,
    sampleDecodes: 0,
    refineDecodes: 0,
    tracks: 0,
    flickers: 0,
    ms: { decode: 0, encode: 0, request: 0, engine: 0, parse: 0 },
  };
  return {
    sampled(frames, reused) {
      c.sampled += frames;
      c.reused += reused;
    },
    request(entry) {
      c.requests++;
      c.frames += entry.frames;
      if (entry.engine === 'ppocr-v5') {
        c.devanagariRequests++;
        c.devanagariFrames += entry.frames;
      }
      c.languages += entry.languages;
      c.maxLanguages = Math.max(c.maxLanguages, entry.languages);
      c.ms.encode += entry.encodeMs;
      c.ms.request += entry.requestMs;
      c.ms.engine += entry.engineMs;
      c.ms.parse += entry.parseMs;
    },
    tracked(flicker) {
      c.tracks++;
      if (flicker) c.flickers++;
    },
    refined(frames) {
      c.refineCalls += frames;
    },
    decoded(purpose, took) {
      if (purpose === 'sample') c.sampleDecodes++;
      else c.refineDecodes++;
      c.ms.decode += took;
    },
    counts() {
      const round = (v: number) => Math.round(v);
      return {
        ...c,
        ms: {
          decode: round(c.ms.decode),
          encode: round(c.ms.encode),
          request: round(c.ms.request),
          engine: round(c.ms.engine),
          parse: round(c.ms.parse),
        },
      };
    },
  };
}

/** Adds one job's counts to another's (a run's total, a clip's shots). */
export function addOcrCounts(a: OcrCounts, b: OcrCounts): OcrCounts {
  return {
    sampled: a.sampled + b.sampled,
    reused: a.reused + b.reused,
    requests: a.requests + b.requests,
    frames: a.frames + b.frames,
    devanagariRequests: a.devanagariRequests + b.devanagariRequests,
    devanagariFrames: a.devanagariFrames + b.devanagariFrames,
    languages: a.languages + b.languages,
    maxLanguages: Math.max(a.maxLanguages, b.maxLanguages),
    refineCalls: a.refineCalls + b.refineCalls,
    sampleDecodes: a.sampleDecodes + b.sampleDecodes,
    refineDecodes: a.refineDecodes + b.refineDecodes,
    tracks: a.tracks + b.tracks,
    flickers: a.flickers + b.flickers,
    ms: {
      decode: a.ms.decode + b.ms.decode,
      encode: a.ms.encode + b.ms.encode,
      request: a.ms.request + b.ms.request,
      engine: a.ms.engine + b.ms.engine,
      parse: a.ms.parse + b.ms.parse,
    },
  };
}
