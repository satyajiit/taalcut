// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every error @taalcut/media can return. Each one carries the tail of the
 * process's stderr in `detail` (developer-only) when a process was involved.
 * Message keys are 'errors.<code>' (see SPEC.md for the catalogue entries).
 */
import { basename } from 'node:path';
import { defineError } from '@taalcut/core';

/** No usable ffmpeg/ffprobe binary: missing, not executable, or not where configuration said. */
export const FfmpegNotFound = defineError<{ binary: string }>('media.ffmpeg_not_found');

/** The binary works but its licence is not allowed (GPL or non-free while LGPL is required). */
export const FfmpegLicenceRejected = defineError<{ binary: string; licence: string }>(
  'media.ffmpeg_licence_rejected',
);

/**
 * A bundled FFmpeg (sidecar or tools/ffmpeg/dist) that is not the build its
 * BUILDINFO.json describes, or whose BUILDINFO is missing, not LGPL, or for
 * another FFmpeg release. `reason` is a BuildMismatchReason.
 */
export const FfmpegBuildMismatch = defineError<{ binary: string; reason: string }>(
  'media.ffmpeg_build_mismatch',
);

/** An ffmpeg command exited with a non-zero code. */
export const FfmpegFailed = defineError<{ exitCode: number }>('media.ffmpeg_failed');

/** The OS refused to start the process for a reason other than a missing binary (e.g. too many open files). */
export const SpawnFailed = defineError('media.spawn_failed', { retryable: true });

/**
 * Params of an error about one of the user's files. `name` is the file's name
 * (`IMG_0420.MOV`) for the message a window shows; params reach windows, so
 * the full path is never here. It goes in `detail`, which core strips.
 */
export type FileParams = {
  readonly name: string;
};

export function fileParams(path: string): FileParams {
  return { name: basename(path) || path };
}

/** The input file does not exist or is not a regular file. */
export const MediaFileNotFound = defineError<FileParams>('media.file_not_found');

/** ffprobe could not read the file, or printed output that failed validation. */
export const ProbeFailed = defineError<FileParams>('media.probe_failed');

/** ffmpeg could not decode the requested frame (corrupt file, no video stream, time past the end). */
export const DecodeFailed = defineError<FileParams>('media.decode_failed');

/** No encoder for the codec: no hardware encoder that works, and no LGPL software fallback in the build. */
export const NoEncoder = defineError<{ codec: string }>('media.no_encoder');

/** The caller aborted the operation. */
export const MediaCancelled = defineError('media.cancelled');

/** The process ran longer than its time limit. */
export const MediaTimeout = defineError<{ ms: number }>('media.timeout', { retryable: true });

/** The process wrote more to stdout than the capture limit allows. */
export const OutputTooLarge = defineError<{ limitBytes: number }>('media.output_too_large');

/** No decodable video or audio, or a RAW/DNG still this package does not read. */
export const UnsupportedMedia = defineError<FileParams>('media.unsupported_media');

/** A still (JPEG, PNG, HEIC) could not be decoded into an upright SDR image. */
export const StillDecodeFailed = defineError<FileParams>('media.still_decode_failed');

/** The cache root is missing or a write failed. Retryable: the volume may come back. */
export const CacheUnavailable = defineError('media.cache_unavailable', { retryable: true });

/** Pinned derived files alone are bigger than the cap, so nothing can be evicted. */
export const CachePinnedOverCap = defineError<{ capBytes: number }>('media.cache_pinned_over_cap');

/** onnxruntime-node is not installed in this component. */
export const OnnxUnavailable = defineError<{ model: string }>('media.onnx_unavailable');

/** A session failed to run. Retryable. */
export const OnnxFailed = defineError<{ model: string }>('media.onnx_failed', { retryable: true });
