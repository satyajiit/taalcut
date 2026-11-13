// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How local files are handed to ffmpeg and ffprobe, so that a read stays on
 * the one file that was asked for.
 */
import { realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { fileParams, MediaFileNotFound } from './errors';

/**
 * The input argument for a local file. Absolute and prefixed with `file:`, so a
 * name like 'http:clip.mp4', 'concat:a|b' or '-y.mp4' is read as a plain file,
 * never as a protocol or an option.
 */
export function fileInput(path: string): string {
  return `file:${resolve(path)}`;
}

/**
 * Demuxers allowed to open user media (FFmpeg names, `ffmpeg -demuxers`). A
 * positive list, because some demuxers read other files named inside the
 * input: HLS and DASH playlists, concat scripts, IMF, image2 sequences.
 * `-protocol_whitelist file` doesn't stop those: an HLS playlist with a
 * `../` segment reads any local file. FFmpeg passes the list on to nested
 * demuxers and fails with "Format not on whitelist" for anything else.
 */
export const USER_MEDIA_DEMUXERS = [
  // Video containers from phones, cameras, editors and the web.
  'mov',
  'matroska',
  'avi',
  'mpegts',
  'mpeg',
  'mxf',
  'flv',
  'asf',
  'ogg',
  'dv',
  'gif',
  // Raw camera and drone streams.
  'h264',
  'hevc',
  'm4v',
  // Audio.
  'wav',
  'aiff',
  'mp3',
  'aac',
  'flac',
  'caf',
  'w64',
  'ac3',
  'eac3',
  'amr',
  // Single stills, read by content (the image2 demuxer is left out: it reads numbered sequences).
  'jpeg_pipe',
  'png_pipe',
  'webp_pipe',
  'tiff_pipe',
  'bmp_pipe',
] as const;

/** Input options for every user file: local files only, and only demuxers that don't open other files. */
export const USER_MEDIA_INPUT = [
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  USER_MEDIA_DEMUXERS.join(','),
] as const;

/**
 * A still extension is forced onto its pipe demuxer. ffprobe otherwise picks
 * `image2` from the name, and that demuxer is off the list because it opens sequences.
 */
const STILL_PIPE: Readonly<Record<string, string>> = {
  '.jpg': 'jpeg_pipe',
  '.jpeg': 'jpeg_pipe',
  '.png': 'png_pipe',
  '.webp': 'webp_pipe',
  '.tif': 'tiff_pipe',
  '.tiff': 'tiff_pipe',
  '.bmp': 'bmp_pipe',
};

export function stillPipeDemuxer(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return undefined;
  return STILL_PIPE[base.slice(dot).toLowerCase()];
}

/**
 * Checks that `path` is an existing regular file and returns its canonical
 * path (symlinks and `..` resolved). Callers read and report that path, so a
 * grant check on the result sees the real target, not the link.
 */
export async function requireFile(path: string): AsyncResult<string> {
  const absolute = resolve(path);
  try {
    const real = await realpath(absolute);
    const info = await stat(real);
    if (info.isFile()) return ok(real);
    return err(MediaFileNotFound(fileParams(absolute), { detail: `${real} is not a regular file` }));
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? 'unknown';
    return err(MediaFileNotFound(fileParams(absolute), { detail: `${absolute}: ${code}` }));
  }
}

/**
 * Identifies a file's current contents cheaply, for idempotency keys:
 * canonical path (symlinks resolved, as probe reports it), size and
 * modification time. Hashing a multi-gigabyte video is not cheap; this
 * changes whenever the file is replaced or edited in place.
 */
export function fileFingerprint(path: string): string {
  const absolute = resolve(path);
  try {
    const real = realpathSync(absolute);
    const info = statSync(real);
    return `${real}|${info.size}|${Math.trunc(info.mtimeMs)}`;
  } catch {
    return `${absolute}|missing`;
  }
}
