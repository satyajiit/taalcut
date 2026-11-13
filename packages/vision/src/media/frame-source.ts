// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame source port (IX-D1): how vision's indexing stages get an asset's
 * frames without each decoding the video again. A stage asks for grid frames
 * at a size, or for the whole-file analysis pass; the source answers from
 * the asset's frame cache where an earlier stage left them, and decodes the
 * rest (several sizes in one run per seek window). Which file it decodes
 * (the original, or the proxy when the policy picks it) is the
 * implementation's business: `openFrameSource` in media-frame-source.ts.
 */
import type { AsyncResult } from '@taalcut/core';
import type { DecodeCount, RgbBatch, TimeInterval } from '@taalcut/media';
import type { FrameFormat, SampledFrame, VideoSource } from './frames';

/** Exactly `width` × `height` (a model's input grid), or the picture's aspect with `longSide` on its long edge. */
export type FrameSize = { readonly width: number; readonly height: number } | { readonly longSide: number };

export interface FrameRequest {
  readonly size: FrameSize;
  /** `jpeg`: encoded frames (a describer's input); the others raw pixels. */
  readonly format: FrameFormat | 'jpeg';
  /** Grid frames; frames past the end are left out. */
  readonly frames: readonly number[];
}

export interface PassFrame {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** gray, row-major. */
  readonly data: Uint8Array;
}

/**
 * Small RGB frames handed over while the pass decodes (IX2-C3): every `every`-th grid frame at exactly
 * `width` × `height`, the shot-boundary model's input. A long video's segments each stream their frames in
 * order, pre-roll included; a segment starts at least `context` stream frames before its own range.
 */
export interface PassStream {
  readonly width: number;
  readonly height: number;
  readonly every: number;
  readonly context: number;
  /** The pass reads on once this settles (the frames wait on disk meanwhile, not in memory). */
  onFrames(batch: RgbBatch, segment: number): Promise<void>;
}

export interface PassRequest {
  /** Long side of the analysis frames. */
  readonly longSide: number;
  /** Also score every n-th frame against the previous sample (shot candidates). */
  readonly coarseEvery?: number;
  /**
   * Every analysis frame, in order within its segment. A long video may be decoded in segments side by side
   * (IX-D7): each segment's frames come in order, from a little before its start (its pre-roll), so per-frame
   * state belongs to the segment.
   */
  readonly onFrame?: (frame: PassFrame, segment: number) => void;
  /** Frame spacing every per-frame state of the caller keeps (its sampling): segments start on its multiples. */
  readonly align?: number;
  /** Segments of a long video that may decode at once (the video class budget); 1 or absent: one pass. */
  readonly parallel?: number;
  /** Frames to keep for later stages while the pass decodes: every `every`-th grid frame at a size. */
  readonly keep?: readonly {
    readonly size: { readonly width: number; readonly height: number };
    readonly format: FrameFormat;
    readonly every: number;
  }[];
  readonly stream?: PassStream;
}

export interface SceneScore {
  readonly index: number;
  readonly score: number;
  readonly mafd: number;
}

export interface PassSegmentRange {
  /** First frame the segment owns. */
  readonly start: number;
  /** One past its last. */
  readonly end: number;
}

export interface PassResult {
  /** Every grid frame's scene score. */
  readonly fine: readonly SceneScore[];
  /** Every `coarseEvery`-th frame's. */
  readonly coarse: readonly SceneScore[];
  readonly black: readonly TimeInterval[];
  readonly freeze: readonly TimeInterval[];
  readonly frames: number;
  /** The frames each segment owns, in order (one segment for a single pass). */
  readonly segments: readonly PassSegmentRange[];
}

export interface FrameSource {
  readonly video: VideoSource;
  /** Where the frames come from: the asset's own file or its proxy. */
  readonly input: 'original' | 'proxy';
  /** The frames, ascending; from the cache where they are, decoded otherwise. */
  frames(request: FrameRequest, signal?: AbortSignal): AsyncResult<SampledFrame[]>;
  /** Decodes what the requests miss together (one run per seek window) and keeps it for later stages. */
  prefetch(requests: readonly FrameRequest[], signal?: AbortSignal): AsyncResult<void>;
  /** One decode of the whole video: scene scores, black and freeze, the gray frames, the frames to keep. */
  pass(request: PassRequest, signal?: AbortSignal): AsyncResult<PassResult>;
  /** Keeps a stage's small result for the asset's later stages: false when the cache has no room for it. */
  putDoc(name: string, value: unknown): AsyncResult<boolean>;
  /** A kept result (undefined when it isn't there). */
  getDoc(name: string): AsyncResult<unknown>;
  /** The stages that will read what this one leaves. */
  expect(consumers: readonly string[]): void;
  /** This stage is done with what earlier stages left. */
  release(consumer: string): Promise<void>;
  /** FFmpeg and ffprobe runs and decodes so far (IX-D6). */
  decodes(): DecodeCount;
  close(): Promise<void>;
}
