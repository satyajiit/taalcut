// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame source's reads (IX-D1): grid frames from the asset's frame
 * cache, and what it lacks decoded with `decodeFrameSets` (every size asked
 * for in one run per seek window, or with the decode service in one decoder
 * session for all of them, IX2-G3), then handed to the cache.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import {
  decodeFrameSets,
  readFrameSlots,
  type AssetFrames,
  type DecodeProfile,
  type DecodeService,
  type FrameCache,
  type FrameFile,
  type FrameFileFormat,
  type GraphSize,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import type { FrameRequest, FrameSize } from './frame-source';
import type { SampledFrame } from './frames';

/** What a source's reads and pass work on: the file decoded, the counted context and the asset's cached frames. */
export interface SourceContext {
  /** The file decoded (the asset's own or its proxy) and the plan that reads it on the asset's grid. */
  readonly input: { readonly path: string; readonly plan: NormalisationPlan };
  readonly media: MediaContext;
  readonly cache: FrameCache;
  readonly frames: AssetFrames;
  /** What every decode of this source shares: the asset's cache folder, the time limit and the decode profile. */
  readonly decode: { readonly dir: string; readonly timeoutMs: number; readonly profile?: DecodeProfile };
  /**
   * Decodes in a process of its own where it can: the whole-file pass (IX2-V3) and the frame reads (IX2-G3);
   * absent: FFmpeg decodes.
   */
  readonly decodeService?: DecodeService;
}

/** One FFmpeg run of a source; the whole-file pass of an hour-long file fits. */
export const SOURCE_TIMEOUT_MS = 60 * 60_000;

export const mediaFormat = (format: FrameRequest['format']): FrameFileFormat =>
  format === 'gray' ? 'gray8' : format;

export const mediaSize = (size: FrameSize): GraphSize =>
  'longSide' in size ? { longSide: size.longSide } : { width: size.width, height: size.height, exact: true };

/**
 * What every frame-set read of the source shares: its folder, time limit and decode profile, and the decode
 * service where there is one (IX2-G3: one decoder session for a read's every frame instead of an FFmpeg run
 * per seek window; FFmpeg seeks for whatever the service doesn't take).
 */
function decodeOptions(ctx: SourceContext) {
  return { ...ctx.decode, ...(ctx.decodeService ? { decodeService: ctx.decodeService } : {}) };
}

/** The cache's set name for frames of one size and format. */
export function frameSetName(size: FrameSize, format: FrameRequest['format']): string {
  const dims = 'longSide' in size ? `l${size.longSide}` : `${size.width}x${size.height}`;
  return `${format}-${dims}`;
}

function sampled(file: FrameFile, index: number, data: Buffer): SampledFrame {
  return { index, width: file.width, height: file.height, data };
}

/** Reads the `wanted` frames of the files, then hands every file to the cache (which deletes what doesn't fit). */
export async function keepFiles(
  ctx: SourceContext,
  files: readonly FrameFile[],
  wanted?: ReadonlyMap<string, ReadonlySet<number>>,
): AsyncResult<Map<string, Map<number, SampledFrame>>> {
  const got = new Map<string, Map<number, SampledFrame>>();
  for (const file of files) {
    const want = wanted?.get(file.set);
    if (want) {
      const read = await readFrameSlots(
        file.path,
        file.slots.filter((slot) => want.has(slot.index)),
      );
      if (!read.ok) return read;
      const into = got.get(file.set) ?? new Map<number, SampledFrame>();
      for (const [index, data] of read.value) into.set(index, sampled(file, index, data));
      got.set(file.set, into);
    }
    await ctx.frames.adopt(file);
  }
  return ok(got);
}

async function cachedFrames(
  ctx: SourceContext,
  set: string,
  indexes: readonly number[],
): AsyncResult<Map<number, SampledFrame>> {
  const found = ctx.frames.find(set, indexes);
  const read = await ctx.frames.read(set, [...found.keys()]);
  if (!read.ok) return read;
  const out = new Map<number, SampledFrame>();
  for (const [index, { file }] of found) {
    const data = read.value.get(index);
    if (data) out.set(index, sampled(file, index, data));
  }
  return ok(out);
}

/** Grid frames at one size: from the cache, the rest decoded in one run and kept. */
export async function readFrames(
  ctx: SourceContext,
  request: FrameRequest,
  signal: AbortSignal | undefined,
): AsyncResult<SampledFrame[]> {
  if (signal?.aborted) return err(CancelledError());
  const set = frameSetName(request.size, request.format);
  const have = await cachedFrames(ctx, set, request.frames);
  if (!have.ok) return have;
  const missing = [...new Set(request.frames)].filter((index) => !have.value.has(index));
  if (missing.length > 0) {
    const decoded = await decodeFrameSets(ctx.input.path, ctx.input.plan, ctx.media, {
      sets: [{ set, size: mediaSize(request.size), format: mediaFormat(request.format), frames: missing }],
      ...decodeOptions(ctx),
      ...(signal ? { signal } : {}),
    });
    if (!decoded.ok) return decoded;
    const kept = await keepFiles(ctx, decoded.value, new Map([[set, new Set(missing)]]));
    if (!kept.ok) return kept;
    for (const [index, frame] of kept.value.get(set) ?? []) have.value.set(index, frame);
  }
  return ok([...have.value.values()].sort((a, b) => a.index - b.index));
}

/** Decodes what the cache lacks of several requests in one run and keeps it for later reads. */
export async function prefetchFrames(
  ctx: SourceContext,
  requests: readonly FrameRequest[],
  signal: AbortSignal | undefined,
): AsyncResult<void> {
  if (signal?.aborted) return err(CancelledError());
  const sets = new Map<string, { request: FrameRequest; frames: Set<number> }>();
  for (const request of requests) {
    const set = frameSetName(request.size, request.format);
    const entry = sets.get(set) ?? { request, frames: new Set<number>() };
    const found = ctx.frames.find(set, request.frames);
    for (const index of request.frames) if (!found.has(index)) entry.frames.add(index);
    sets.set(set, entry);
  }
  const wanted = [...sets.entries()].filter(([, entry]) => entry.frames.size > 0);
  if (wanted.length === 0) return ok(undefined);
  const decoded = await decodeFrameSets(ctx.input.path, ctx.input.plan, ctx.media, {
    sets: wanted.map(([set, entry]) => ({
      set,
      size: mediaSize(entry.request.size),
      format: mediaFormat(entry.request.format),
      frames: [...entry.frames],
    })),
    ...decodeOptions(ctx),
    ...(signal ? { signal } : {}),
  });
  if (!decoded.ok) return decoded;
  const kept = await keepFiles(ctx, decoded.value);
  return kept.ok ? ok(undefined) : kept;
}
