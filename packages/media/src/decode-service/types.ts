// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The decode service (IX2-V3): a whole-file (or windowed) video decode in a process of its own, for the
 * analysis pass, and explicit frames for the frame source's reads (IX2-G3). It decodes, turns upright and scales on the decoder's device and writes raw frames: the
 * analysis frames (NV12, every grid frame) to a file or FIFO a CPU FFmpeg reads, and frame sets (rgb24 or
 * gray) to files. On a Mac the mac helper is the implementation (`decode.pass`, VideoToolbox with several
 * frames in flight, where FFmpeg's hwaccel waits for each frame); a platform without one has no service and
 * every pass stays on FFmpeg's own decode route.
 */
import type { AsyncResult } from '@taalcut/core';

export interface DecodePassSet {
  readonly width: number;
  readonly height: number;
  /** Every n-th grid frame of the window, counted from its first frame. */
  readonly every: number;
  readonly maxFrames: number;
  readonly format: 'rgb24' | 'gray8';
  readonly path: string;
}

export interface DecodePassRequest {
  readonly path: string;
  /** The grid: every decoded frame must sit on it, or the pass fails with `decode.off_grid`. */
  readonly rate: { readonly num: number; readonly den: number };
  /** Grid frames [from, from + frames) of the whole file. */
  readonly window?: { readonly from: number; readonly frames: number };
  /** Clockwise degrees that turn the stored picture upright. */
  readonly rotation: 0 | 90 | 180 | 270;
  /** The range the reader of the analysis frames tags them with; a stream of the other range is declined. */
  readonly range: 'full' | 'video';
  /** Every grid frame, upright, scaled to exactly this size, as packed NV12. */
  readonly analysis: { readonly width: number; readonly height: number; readonly path: string };
  readonly sets: readonly DecodePassSet[];
}

export interface DecodePassReport {
  /** Grid frames written to the analysis output. */
  readonly frames: number;
  /** Frame-set frames written, in request order. */
  readonly sets: readonly number[];
  /** The decode's wall time. */
  readonly ms: number;
}

/** Explicit grid frames at one size, written as packed NV12 to `path` in ascending order. */
export interface DecodeFramesSet {
  readonly width: number;
  readonly height: number;
  /** Ascending, distinct grid frames. */
  readonly frames: readonly number[];
  readonly path: string;
}

/**
 * Explicit grid frames of one file (IX2-G3): one decoder session for all of them, reading from the sync sample
 * before each group of frames closer than `gapSeconds` (FFmpeg's seek windows). Frames are upright and scaled as
 * FFmpeg's VideoToolbox route scales them, still NV12: the caller converts them as that route converts its
 * downloaded frames.
 */
export interface DecodeFramesRequest {
  readonly path: string;
  /** The grid: frame n is the one shown at n / rate from the stream's start. */
  readonly rate: { readonly num: number; readonly den: number };
  /** Clockwise degrees that turn the stored picture upright. */
  readonly rotation: 0 | 90 | 180 | 270;
  /** The range the caller tags the frames with; a stream of the other range is declined. */
  readonly range: 'full' | 'video';
  readonly gapSeconds: number;
  readonly sets: readonly DecodeFramesSet[];
}

export interface DecodeFramesReport {
  /** Per set, the grid frames written, in file order (frames past the end are left out). */
  readonly written: readonly (readonly number[])[];
  /** Frames the decoder produced, pre-roll included. */
  readonly decoded: number;
  /** Reads from a sync sample (FFmpeg would have run one process per read). */
  readonly reads: number;
  readonly ms: number;
}

export interface DecodePassOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /**
   * Runs once the service has let go of the pass's decoder session (IX2-F4): at its reply, a cancel's included, or
   * when its process exits; at once for a pass it never started. A cancel the service doesn't answer within its
   * grace settles the pass first, and this waits on, so a hardware session lease released here stays held while
   * the session may still be open. Never by a signal: nothing on this path signals the service.
   */
  readonly onLetGo?: () => void;
  /**
   * Called with the service's pid just before the pass is sent to it (a helper process), so a lease records the pid
   * on disk first (IX3-F7); not called for a pass never sent.
   */
  readonly onSend?: (pid: number) => void;
}

/** The decodes a service can take (IX2-F14): the whole-file analysis pass, and explicit frame reads. */
export type DecodeServiceTask = 'pass' | 'frames';

export interface DecodeService {
  /** For logs: `mac-helper`. */
  readonly id: string;
  /**
   * The decodes it takes (the `TAALCUT_DECODE_SERVICE` switch, switch.ts); FFmpeg decodes the others without asking
   * it. Absent: both.
   */
  readonly tasks?: readonly DecodeServiceTask[];
  /**
   * One decode. A cancel or a timeout settles once the service answers it, or after a grace when it doesn't;
   * `onLetGo` says when its decoder session is really closed. While a pass it didn't answer may still hold a
   * session, the service starts no other: a pass then declines at once with `decode.unanswered_cancel`, and the
   * caller decodes elsewhere. Helper failure codes come back as `media.sidecar_rejected` or, retryable,
   * `media.sidecar_failed`, with `helperCode` (`decode.unsupported`, `decode.off_grid`, …).
   */
  pass(request: DecodePassRequest, options?: DecodePassOptions): AsyncResult<DecodePassReport>;
  /**
   * Explicit frames (IX2-G3), with the same failure codes, cancel, settling and `onLetGo` as `pass`; a pass or a
   * frame read the service didn't answer holds off both.
   */
  frames(request: DecodeFramesRequest, options?: DecodePassOptions): AsyncResult<DecodeFramesReport>;
  /**
   * A file the service can't read as FFmpeg does (eligible.ts `avoidsFile`): later passes and frame reads leave it
   * to FFmpeg (this process).
   */
  avoid(path: string, reason: string): void;
  /** Why `path` is left to FFmpeg, or undefined. */
  avoided(path: string): string | undefined;
  close(): Promise<void>;
}
