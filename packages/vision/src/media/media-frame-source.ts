// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame source over media (IX-D1): frames come from media's frame cache
 * (`createFrameCache`), and what it lacks is decoded with `decodeFrameSets`
 * (every size a stage asks for in one run per seek window) or, for the whole
 * file, `runAnalysisPass`. It reads the asset's own file or its proxy, as
 * `frameInput` (frame-source-policy.ts) chose; either way frames are indexed
 * on the asset's grid. Normalise's stored plan saves the probe; every
 * FFmpeg and ffprobe run is counted for the job's `decodes`.
 */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import {
  countedContext,
  createDecodeTally,
  createFrameCache,
  type DecodeProfile,
  type DecodeService,
  type FrameCache,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import type { FrameSource } from './frame-source';
import { runPass } from './frame-source-pass';
import { prefetchFrames, readFrames, SOURCE_TIMEOUT_MS, type SourceContext } from './frame-source-reads';
import { probeSource, videoSourceOf, type VideoSource } from './frames';

export { frameSetName } from './frame-source-reads';

export interface FrameSourceDeps {
  readonly media: MediaContext;
  /** The jobs process's cache. Absent: a private one under `tempDir`, gone when the source closes. */
  readonly cache?: FrameCache;
  readonly tempDir: string;
  readonly profile?: DecodeProfile;
  /** The analysis pass's decode in a process of its own (IX2-V3, the mac helper); absent: FFmpeg decodes. */
  readonly decodeService?: DecodeService;
}

export interface OpenFrameSource {
  /** The cache's key for the asset (absent: frames aren't shared with other stages). */
  readonly assetId?: string;
  /** The asset's own file. */
  readonly path: string;
  /** Normalise's plan (absent: probed). */
  readonly plan?: NormalisationPlan;
  /** Decode this file instead: the proxy, with the plan that reads it on the asset's grid. */
  readonly proxy?: { readonly path: string; readonly plan: NormalisationPlan };
  readonly signal?: AbortSignal;
}

async function videoOf(media: MediaContext, open: OpenFrameSource): AsyncResult<VideoSource> {
  return open.plan ? ok(videoSourceOf(open.path, open.plan)) : probeSource(media, open.path, open.signal);
}

export async function openFrameSource(
  deps: FrameSourceDeps,
  open: OpenFrameSource,
): AsyncResult<FrameSource> {
  if (open.signal?.aborted) return err(CancelledError());
  const tally = createDecodeTally(open.path);
  const media = countedContext(deps.media, tally);
  const video = await videoOf(media, open);
  if (!video.ok) return video;
  const cache = deps.cache ?? createFrameCache({ root: join(deps.tempDir, `frames-${randomUUID()}`) });
  const asset = open.assetId ?? randomUUID();
  const held = await cache.open(asset);
  if (!held.ok) return held;
  const hold = held.value;
  const ctx: SourceContext = {
    input: open.proxy ?? { path: open.path, plan: video.value.plan },
    media,
    cache,
    frames: hold.frames,
    decode: {
      dir: hold.frames.dir,
      timeoutMs: SOURCE_TIMEOUT_MS,
      ...(deps.profile ? { profile: deps.profile } : {}),
    },
    ...(deps.decodeService ? { decodeService: deps.decodeService } : {}),
  };
  const source: FrameSource = {
    video: video.value,
    input: open.proxy ? 'proxy' : 'original',
    frames: (request, signal) => readFrames(ctx, request, signal),
    prefetch: (requests, signal) => prefetchFrames(ctx, requests, signal),
    pass: (request, signal) => runPass(ctx, request, signal),
    putDoc: (name, value) => hold.frames.putDoc(name, value),
    getDoc: (name) => hold.frames.getDoc(name),
    expect: (consumers) => hold.expect(consumers),
    release: (consumer) => cache.release(asset, consumer),
    decodes: () => tally.snapshot(),
    async close() {
      await hold.close();
      if (cache !== deps.cache) {
        await cache.drop(asset);
        await rm(cache.root, { recursive: true, force: true });
      }
    },
  };
  return ok(source);
}

/**
 * Runs `use` on `given`, or on a private source over `path` (probed, decoding alone, closed after): what a
 * stage called outside the jobs (a tool, a test) gets.
 */
export async function withFrameSource<T>(
  given: FrameSource | undefined,
  media: MediaContext,
  path: string,
  signal: AbortSignal | undefined,
  use: (frames: FrameSource) => AsyncResult<T>,
): AsyncResult<T> {
  if (given) return use(given);
  const opened = await openFrameSource({ media, tempDir: tmpdir() }, { path, ...(signal ? { signal } : {}) });
  if (!opened.ok) return opened;
  try {
    return await use(opened.value);
  } finally {
    await opened.value.close();
  }
}
