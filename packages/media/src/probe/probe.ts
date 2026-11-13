// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * probeMedia: path in, Result<ProbeResult> out. This is the function the
 * `media.probe` agent tool (P1-G7) wraps.
 */
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { z } from 'zod';
import { fileParams, MediaFileNotFound, ProbeFailed } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { fileInput, stillPipeDemuxer, USER_MEDIA_INPUT, requireFile } from '../input';
import { runProcess } from '../process/runner';
import { readMovieBox } from './boxes';
import { mapProbeOutput } from './map';
import { phoneBoxesOf, type PhoneBoxes } from './phone-boxes';
import { ffprobeOutputSchema } from './schema';
import type { ProbeResult } from './types';

export interface ProbeOptions {
  readonly signal?: AbortSignal;
  /** Default 30 s: probing reads headers only, so anything slower is a stuck network volume. */
  readonly timeoutMs?: number;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

/** ffprobe arguments for one file. Stream side data (display matrix, Dolby Vision) comes with -show_streams. */
export function probeArgs(path: string): string[] {
  const still = stillPipeDemuxer(path);
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-show_chapters',
    ...USER_MEDIA_INPUT,
    ...(still ? ['-f', still] : []),
    '-i',
    fileInput(path),
  ];
}

export async function probeMedia(
  path: string,
  ctx: MediaContext,
  options: ProbeOptions = {},
): AsyncResult<ProbeResult> {
  const checked = await requireFile(path);
  if (!checked.ok) return checked;
  const absolute = checked.value;
  const file = fileParams(absolute);

  const run = ctx.runner ?? runProcess;
  const result = await run(ctx.binaries.ffprobe, probeArgs(absolute), {
    timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    maxStdoutBytes: 8 * 1024 * 1024,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result.ok) return result;

  const { exitCode, stdout, stderrTail } = result.value;
  if (exitCode !== 0) {
    // The file can vanish between the check and the read (an ejected drive).
    if (/No such file or directory/i.test(stderrTail))
      return err(MediaFileNotFound(file, { detail: `${absolute}\n${stderrTail}` }));
    return err(
      ProbeFailed(file, {
        detail: `${absolute}: ffprobe exited with code ${String(exitCode)}\n${stderrTail}`,
      }),
    );
  }
  const json = stdout.toString('utf8');
  return parseProbeJson(absolute, json, await boxesFor(absolute, json));
}

/** ffprobe's demuxer for MP4 and QuickTime files. Other containers have no `moov` to read. */
const ISO_MEDIA = /"format_name"\s*:\s*"mov,mp4/;

/** The `moov` boxes ffprobe doesn't pass on (phone-boxes.ts), for an MP4 or QuickTime file. */
async function boxesFor(path: string, json: string): Promise<PhoneBoxes | undefined> {
  if (!ISO_MEDIA.test(json)) return undefined;
  const movie = await readMovieBox(path);
  return movie ? phoneBoxesOf(movie) : undefined;
}

/**
 * Validates ffprobe's JSON and maps it, with the file's phone boxes when they were read. Separate from probeMedia
 * so it is testable without ffprobe.
 */
export function parseProbeJson(path: string, json: string, boxes?: PhoneBoxes): Result<ProbeResult> {
  const file = fileParams(path);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return err(
      ProbeFailed(file, {
        detail: `${path}: ffprobe printed invalid JSON: ${reason}\n${json.slice(0, 500)}`,
      }),
    );
  }
  const parsed = ffprobeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = `${path}: ffprobe output failed schema validation:\n${z.prettifyError(parsed.error)}`;
    return err(ProbeFailed(file, { detail }));
  }
  const probe = mapProbeOutput(path, parsed.data, boxes);
  if (!probe.video && !probe.audio) {
    const detail = `${path}: no audio or video stream (${probe.container.formatName})`;
    return err(ProbeFailed(file, { detail }));
  }
  return ok(probe);
}
