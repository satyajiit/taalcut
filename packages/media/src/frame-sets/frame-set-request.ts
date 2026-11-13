// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a frame-set read asks for (decode-frame-sets.ts on FFmpeg, service-frame-sets.ts on the decode
 * service): explicit grid frames per set, the seek windows that group them, and the output arguments that
 * write each format.
 */
import type { DecodeService } from '../decode-service/types';
import type { DecodeProfile } from '../decode-routes/select-route';
import type { GraphSize } from '../normalise/graph';
import type { FrameFileFormat } from './frame-files';

export interface FrameSetRequest {
  /** The caller's name for the set (a cache key). */
  readonly set: string;
  readonly size: GraphSize;
  readonly format: FrameFileFormat;
  /** Grid frames; frames past the end are left out of the result. */
  readonly frames: readonly number[];
  /** JPEG only: FFmpeg's quality scale, 2 (best) to 31. Default 3. */
  readonly jpegQuality?: number;
}

export interface DecodeFrameSetsOptions {
  readonly sets: readonly FrameSetRequest[];
  /** Where the files are written. */
  readonly dir: string;
  readonly profile?: DecodeProfile;
  readonly signal?: AbortSignal;
  /** Per FFmpeg run. Default 30 minutes. */
  readonly timeoutMs?: number;
  /** Frames closer than this share one seek. Default `WINDOW_GAP_SECONDS`. */
  readonly windowGapSeconds?: number;
  /**
   * Reads every set from one decoder session in a process of its own where it can (IX2-G3,
   * service-frame-sets.ts); absent, or a file it can't take: FFmpeg seeks, one run per window.
   */
  readonly decodeService?: DecodeService;
}

/** Frames closer than this share one seek. */
export const WINDOW_GAP_SECONDS = 2;
/** Per FFmpeg run, or per service read, unless the caller says. */
export const FRAME_SETS_TIMEOUT_MS = 30 * 60_000;

interface Window {
  readonly first: number;
  readonly last: number;
}

/** Sorted, unique frames grouped into runs one seek covers. */
export function seekWindows(
  frames: readonly number[],
  fps: number,
  gapSeconds: number = WINDOW_GAP_SECONDS,
): Window[] {
  const sorted = [...new Set(frames.filter((f) => Number.isInteger(f) && f >= 0))].sort((a, b) => a - b);
  const gap = gapSeconds * fps;
  const windows: { first: number; last: number }[] = [];
  for (const frame of sorted) {
    const current = windows[windows.length - 1];
    if (current && frame - current.last <= gap) current.last = frame;
    else windows.push({ first: frame, last: frame });
  }
  return windows;
}

export function frameFileArgs(format: FrameFileFormat, jpegQuality = 3): string[] {
  if (format === 'jpeg') return ['-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', String(jpegQuality)];
  return ['-f', 'rawvideo', '-pix_fmt', format === 'gray8' ? 'gray' : format];
}
