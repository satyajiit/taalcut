// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frames a decode wrote to a file: raw frames back to back (rgb24, gray or
 * planar yuv420p), or JPEGs one after another. The file's index says which grid frame sits where,
 * so a cache can keep the file as it is and read single frames back.
 */
import { open, readFile, rm, stat } from 'node:fs/promises';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { FfmpegFailed } from '../errors';

export type FrameFileFormat = 'rgb24' | 'gray8' | 'yuv420p' | 'jpeg';

export interface FrameSlot {
  readonly index: number;
  readonly offset: number;
  readonly length: number;
}

export interface FrameFile {
  /** The caller's name for the set it belongs to. */
  readonly set: string;
  readonly path: string;
  readonly format: FrameFileFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** Grid frames in the file, in order. */
  readonly slots: readonly FrameSlot[];
}

export function bytesPerFrame(format: FrameFileFormat, width: number, height: number): number {
  if (format === 'yuv420p') return width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
  return width * height * (format === 'rgb24' ? 3 : 1);
}

/** A frame file that is missing, unreadable or not what its decode should have written. */
export function frameFileError(cause: unknown, what: string) {
  return err(FfmpegFailed({ exitCode: -1 }, { detail: cause instanceof Error ? cause.message : what }));
}

/** Deletes frame files (and a decode's other scratch files); one already gone is fine. */
export async function removeFrameFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

/** `result`, once `paths` are deleted: a decode that failed or used them up leaves no files behind. */
export async function withoutFiles<T>(paths: readonly string[], result: Result<T>): AsyncResult<T> {
  await removeFrameFiles(paths);
  return result;
}

/** JPEG start and end markers: each image's byte range in a concatenated stream. */
function jpegRanges(body: Buffer): { offset: number; length: number }[] {
  const ranges: { offset: number; length: number }[] = [];
  let at = 0;
  for (;;) {
    const start = body.indexOf(Buffer.from([0xff, 0xd8]), at);
    if (start < 0) return ranges;
    const end = body.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) return ranges;
    ranges.push({ offset: start, length: end + 2 - start });
    at = end + 2;
  }
}

/**
 * Indexes a file a decode wrote: frame k of it is `frames[k]`. A short file
 * (the stream ended early) indexes the frames it has; extra frames are dropped.
 */
export async function indexFrameFile(spec: {
  readonly set: string;
  readonly path: string;
  readonly format: FrameFileFormat;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly number[];
}): AsyncResult<FrameFile> {
  let size: number;
  try {
    size = (await stat(spec.path)).size;
  } catch (cause) {
    return frameFileError(cause, 'frame file missing');
  }
  let ranges: { offset: number; length: number }[];
  if (spec.format === 'jpeg') {
    try {
      ranges = jpegRanges(await readFile(spec.path));
    } catch (cause) {
      return frameFileError(cause, 'frame file unreadable');
    }
  } else {
    const length = bytesPerFrame(spec.format, spec.width, spec.height);
    // A file that isn't whole frames of this size was written at another size: reading it would shift every frame.
    if (length <= 0 || size % length !== 0) {
      return frameFileError(
        undefined,
        `${size} bytes are not whole ${spec.width}x${spec.height} ${spec.format} frames`,
      );
    }
    ranges = Array.from({ length: size / length }, (_, k) => ({ offset: k * length, length }));
  }
  const slots = ranges
    .slice(0, spec.frames.length)
    .map((range, k) => ({ index: spec.frames[k] as number, ...range }));
  return ok({
    set: spec.set,
    path: spec.path,
    format: spec.format,
    width: spec.width,
    height: spec.height,
    bytes: size,
    slots,
  });
}

/** The bytes of some slots of one file, by grid frame. */
export async function readSlots(path: string, slots: readonly FrameSlot[]): AsyncResult<Map<number, Buffer>> {
  const out = new Map<number, Buffer>();
  if (slots.length === 0) return ok(out);
  try {
    const handle = await open(path, 'r');
    try {
      for (const slot of slots) {
        const data = Buffer.alloc(slot.length);
        const { bytesRead } = await handle.read(data, 0, slot.length, slot.offset);
        if (bytesRead === slot.length) out.set(slot.index, data);
      }
    } finally {
      await handle.close();
    }
  } catch (cause) {
    return frameFileError(cause, 'frame file unreadable');
  }
  return ok(out);
}
