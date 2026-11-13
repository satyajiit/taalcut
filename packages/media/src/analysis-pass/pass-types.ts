// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The analysis pass's options and result (run-pass.ts), shared by its two decode routes. */
import type { DecodeProfile } from '../decode-routes/select-route';
import type { DecodeService } from '../decode-service/types';
import type { FrameFile, FrameFileFormat } from '../frame-sets/frame-files';
import type { GraphSize } from '../normalise/graph';
import type { TimeInterval } from '../primitives/parsers';
import type { RgbStream } from './rgb-stream';

export interface PassFrameSet {
  readonly set: string;
  readonly size: GraphSize;
  readonly format: FrameFileFormat;
  readonly every: number;
  /** Frames past this many are not written. */
  readonly maxFrames: number;
}

export interface PassFrame {
  /** Grid frame. */
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** gray, row-major. */
  readonly data: Buffer;
}

/** A minimum duration in seconds for both detectors, or for each. */
export type DetectMinimum = number | { readonly black?: number; readonly freeze?: number };

export interface AnalysisPassOptions {
  /** Long side of the analysis frames. Default 256. */
  readonly size?: number;
  /** Scene scores on every n-th frame too (shot candidates). */
  readonly coarseEvery?: number;
  /** Each analysis frame's gray pixels, in order. */
  readonly onFrame?: (frame: PassFrame) => void;
  readonly frameSets?: readonly PassFrameSet[];
  /** Where frame files (and the pass's scratch files) are written. */
  readonly dir: string;
  readonly profile?: DecodeProfile;
  readonly signal?: AbortSignal;
  /** Default 60 minutes. */
  readonly timeoutMs?: number;
  /**
   * Only grid frames [from, from + frames) (one segment of a long file, segments.ts). `from` should be a
   * multiple of every branch's `every`, so their frames stay on the whole file's multiples. Indexes and
   * times in the result are the whole file's.
   */
  readonly window?: { readonly from: number; readonly frames: number };
  /**
   * blackdetect's and freezedetect's minimum duration: both (a number) or each (a detector left out keeps FFmpeg's
   * 2 s). Segments ask for 0 and stitch; vision asks for every black run and freezes of 2 s (IX3-D2).
   */
  readonly detectMinSeconds?: DetectMinimum;
  /** The shot-boundary model's small RGB stream (IX2-C3). A window's `from` should be a multiple of its `every` too. */
  readonly rgbStream?: RgbStream;
  /**
   * Decodes for the pass in a process of its own where it can take the file (helper-pass.ts): the analysis
   * filters then read its frames. Absent, or a file it can't take: FFmpeg decodes.
   */
  readonly decodeService?: DecodeService;
}

export interface SceneSample {
  /** Grid frame. */
  readonly index: number;
  /** scdet score 0–100 against the previous frame of its branch; 0 for the first. */
  readonly score: number;
  /** Mean absolute frame difference against that frame. */
  readonly mafd: number;
}

export interface AnalysisPassResult {
  /** Every grid frame's scene score. */
  readonly fine: readonly SceneSample[];
  /** Every `coarseEvery`-th frame's (empty without it). */
  readonly coarse: readonly SceneSample[];
  readonly black: readonly TimeInterval[];
  readonly freeze: readonly TimeInterval[];
  /** Analysis frames decoded (the grid's frame count). */
  readonly frames: number;
  readonly files: readonly FrameFile[];
}
