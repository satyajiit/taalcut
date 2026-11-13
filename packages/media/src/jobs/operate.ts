// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 2 operations the service exposes and the job handlers call.
 * Files are written to a temp directory, then moved into the cache by key.
 * A job that must store a file returns media.cache_unavailable when no cache
 * was injected. Reused originals do not need one.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RationalTime, err, ok, type AsyncResult, type DerivedFileRef, type Result } from '@taalcut/core';
import type { DecodeProfileSource } from '../decode-routes/select-route';
import type { DerivedCache } from '../cache/cache';
import { derivedKey, isContentHash } from '../cache/layout';
import { countedContext, type DecodeTally } from '../decode-count/tally';
import { CacheUnavailable } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { conform } from '../normalise/conform';
import { planNormalisation } from '../normalise/plan';
import { makeStill } from '../normalise/still';
import { PLAN_RECIPE, type PlanStill } from '../normalise/types';
import { probeMedia } from '../probe/probe';
import { makePreviews } from '../previews/make-previews';
import type { SpeechPcmPort } from '../previews/speech-pcm-port';
import { makeProxy } from '../proxy/make-proxy';
import { chooseProxyLadder, isPreviewFriendly, proxyRate } from '../proxy/ladder';
import { createProbeStillReader, type StillMetadata, type StillMetadataReader } from '../sidecar/still';
import type {
  ConformJobInput,
  ConformJobOutput,
  EnforceCacheCapJobInput,
  EnforceCacheCapJobOutput,
  MakePreviewsJobInput,
  MakePreviewsJobOutput,
  MakeProxyJobInput,
  NormaliseJobInput,
  NormaliseJobOutput,
  ProxyJobOutput,
} from './phase2-kinds';

const STILL_RECIPE = PLAN_RECIPE;
export const PREVIEW_RECIPE = 1;
const CONFORM_RECIPE = 1;

export interface Phase2Host {
  withContext<T>(fn: (ctx: MediaContext) => AsyncResult<T>): AsyncResult<T>;
  readonly cache?: DerivedCache;
  readonly stillReader?: StillMetadataReader;
  /** Waveform peaks from the audio pass, so waveforms need no second audio decode. */
  readonly speechPcm?: SpeechPcmPort;
  /** The hardware profile's decoder, for the thumbnail's and filmstrip's decode route (IX2-T4: Windows). */
  readonly decodeProfile?: DecodeProfileSource;
}

/** `tally` counts what the operation spawns (IX-D6), for its job output's `decodes`. */
export type RunOptions = { readonly signal?: AbortSignal; readonly tally?: DecodeTally };

/** `ctx` counted in the operation's tally, when it has one. */
export function counted(ctx: MediaContext, options: RunOptions): MediaContext {
  return options.tally ? countedContext(ctx, options.tally) : ctx;
}

export function noCache(): Result<never> {
  return err(CacheUnavailable(undefined, { detail: 'media cache root is not configured' }));
}

export async function withTemp<T>(prefix: string, fn: (dir: string) => AsyncResult<T>): AsyncResult<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function store(cache: DerivedCache, key: string, path: string): AsyncResult<number> {
  try {
    const put = cache.putFile ? await cache.putFile(key, path) : await cache.put(key, await readFile(path));
    if (!put.ok) return put;
    return ok(put.value.bytes);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'cache read failed';
    return err(CacheUnavailable(undefined, { detail }));
  }
}

/**
 * One derived file of the asset whose content hash is `contentHash`: `make` writes `file` in a fresh temp
 * directory, the file is stored in the cache under `key`, and `describe` turns what `make` returned and the
 * stored size into the job's output. Without a cache or a valid hash: `media.cache_unavailable`.
 */
export function storeDerived<T, R>(
  host: Phase2Host,
  contentHash: string,
  spec: { readonly prefix: string; readonly file: string; readonly key: string },
  make: (ctx: MediaContext, out: string) => AsyncResult<T>,
  describe: (made: T, bytes: number) => R,
): AsyncResult<R> {
  const cache = host.cache;
  if (!cache || !isContentHash(contentHash)) return Promise.resolve(noCache());
  return host.withContext((ctx) =>
    withTemp(spec.prefix, async (dir) => {
      const out = join(dir, spec.file);
      const made = await make(ctx, out);
      if (!made.ok) return made;
      const bytes = await store(cache, spec.key, out);
      if (!bytes.ok) return bytes;
      return ok(describe(made.value, bytes.value));
    }),
  );
}

export function ref(
  kind: DerivedFileRef['kind'],
  key: string,
  bytes: number,
  mimeType: DerivedFileRef['mimeType'],
  extra: Partial<Pick<DerivedFileRef, 'width' | 'height' | 'duration' | 'frameRate'>> = {},
): DerivedFileRef {
  return {
    kind,
    key,
    bytes,
    mimeType,
    recipe: kind === 'still' ? STILL_RECIPE : kind === 'conformed' ? CONFORM_RECIPE : PREVIEW_RECIPE,
    ...extra,
  };
}

/** The plan wants flat EXIF fields. The sidecar reader returns a nested GPS object. */
function toPlanStill(meta: StillMetadata): PlanStill {
  const gps = meta.gps;
  return {
    orientation: meta.orientation,
    ...(meta.contentIdentifier ? { contentIdentifier: meta.contentIdentifier } : {}),
    ...(meta.captureTime ? { captureTime: meta.captureTime } : {}),
    ...(meta.offsetTime ? { offsetTime: meta.offsetTime } : {}),
    ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
    ...(gps?.altitude !== undefined ? { altitudeM: gps.altitude } : {}),
    ...(meta.make ? { make: meta.make } : {}),
    ...(meta.model ? { model: meta.model } : {}),
  };
}

function imageLike(formatName: string, frameCount: number | undefined): boolean {
  if ((frameCount ?? 0) < 2) return true;
  return /\b(heic|heif|png|jpeg|jpg|image2|mjpeg|gif|webp|tiff|bmp)\b/i.test(formatName);
}

export function normaliseAsset(
  input: NormaliseJobInput & RunOptions,
  host: Phase2Host,
): AsyncResult<NormaliseJobOutput> {
  return host.withContext(async (context) => {
    const ctx = counted(context, input);
    const probed = await probeMedia(input.path, ctx, input.signal ? { signal: input.signal } : {});
    if (!probed.ok) return probed;
    const video = probed.value.video;
    let stillMeta: Awaited<ReturnType<StillMetadataReader['read']>> | undefined;
    // Only a picture is a still: an audio file has no video stream and plans as audio.
    if (video && imageLike(probed.value.container.formatName, video.frameCount)) {
      const reader = host.stillReader ?? createProbeStillReader(ctx);
      stillMeta = await reader.read(input.path);
      if (!stillMeta.ok) return stillMeta;
    }
    const planned = planNormalisation(probed.value, {
      ...(stillMeta?.ok ? { still: toPlanStill(stillMeta.value) } : {}),
      sizeBytes: input.sizeBytes,
    });
    if (!planned.ok) return planned;
    const plan = planned.value;
    if (!plan.still) return ok({ plan, facts: plan.facts });
    if (!host.cache || !isContentHash(input.contentHash)) return noCache();
    const key = derivedKey('still', input.contentHash, STILL_RECIPE, 'jpg');
    return withTemp('taalcut-still-', async (dir) => {
      const out = join(dir, 'still.jpg');
      const made = await makeStill(input.path, plan, ctx, {
        out,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!made.ok) return made;
      const bytes = await store(host.cache!, key, out);
      if (!bytes.ok) return bytes;
      return ok({
        plan,
        facts: plan.facts,
        still: ref('still', key, bytes.value, 'image/jpeg', {
          width: made.value.width,
          height: made.value.height,
        }),
      });
    });
  });
}

export function proxyAsset(
  input: MakeProxyJobInput & RunOptions,
  host: Phase2Host,
): AsyncResult<ProxyJobOutput> {
  const durationSec = Math.max(0, RationalTime.toSeconds(input.plan.duration));
  const rate = proxyRate(input.plan);
  const fps = rate.den === 0 ? 1 : rate.num / rate.den;
  const ladder = chooseProxyLadder({
    sizeBytes: input.sizeBytes,
    durationSec,
    fps,
    sourceLongSide: Math.max(input.plan.source.displayWidth, input.plan.source.displayHeight),
    previewFriendly: isPreviewFriendly(input.plan, input.path),
  });
  if (!ladder.reusedOriginal && !host.cache) return Promise.resolve(noCache());
  return host.withContext((ctx) =>
    withTemp('taalcut-proxy-', async (dir) => {
      const out = join(dir, 'proxy.mp4');
      const made = await makeProxy(input.path, input.plan, counted(ctx, input), {
        out,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!made.ok) return made;
      const body = {
        reusedOriginal: made.value.reusedOriginal,
        ratio: made.value.ratio,
        overBudget: made.value.overBudget,
        warnings: [...made.value.warnings],
      };
      if (!made.value.file) return ok(body);
      const bytes = await store(host.cache!, made.value.file.key, out);
      if (!bytes.ok) return bytes;
      return ok({ ...body, file: { ...made.value.file, bytes: bytes.value } });
    }),
  );
}

export function previewsAsset(
  input: MakePreviewsJobInput & RunOptions,
  host: Phase2Host,
): AsyncResult<MakePreviewsJobOutput> {
  if (!host.cache || !isContentHash(input.contentHash)) return Promise.resolve(noCache());
  const cache = host.cache;
  const proxyPath = input.proxyKey ? cache.absPath(input.proxyKey) : undefined;
  const source = proxyPath ?? input.path;
  const waveKey = derivedKey('waveform', input.contentHash, PREVIEW_RECIPE, 'bin');
  return host.withContext((ctx) =>
    withTemp('taalcut-preview-', async (dir) => {
      const wavePath = join(dir, 'wave.bin');
      const made = await makePreviews(source, input.plan, counted(ctx, input), {
        out: { waveform: wavePath },
        alreadyNormalised: Boolean(proxyPath),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(host.speechPcm
          ? { pcm: { port: host.speechPcm, path: input.path, contentHash: input.contentHash } }
          : {}),
      });
      if (!made.ok) return made;
      if (!made.value.waveform) return ok({});
      const waveform = await store(cache, waveKey, wavePath);
      if (!waveform.ok) return waveform;
      return ok({ waveform: ref('waveform', waveKey, waveform.value, 'application/octet-stream') });
    }),
  );
}

function conformVariant(input: ConformJobInput): string {
  const size = input.maxLongSide ? `s${input.maxLongSide}` : 'full';
  const range = input.range
    ? createHash('sha256').update(JSON.stringify(input.range)).digest('hex').slice(0, 12)
    : 'all';
  return `${input.codec}.${size}.${range}`;
}

export function conformAsset(
  input: ConformJobInput & RunOptions,
  host: Phase2Host,
): AsyncResult<ConformJobOutput> {
  const key = derivedKey('conformed', input.contentHash, CONFORM_RECIPE, 'mp4', conformVariant(input));
  return storeDerived(
    host,
    input.contentHash,
    { prefix: 'taalcut-conform-', file: 'conform.mp4', key },
    (ctx, out) =>
      conform(input.path, input.plan, counted(ctx, input), {
        out,
        codec: input.codec,
        ...(input.range ? { range: input.range } : {}),
        ...(input.maxLongSide ? { maxLongSide: input.maxLongSide } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    (made, bytes) => ({
      driftMs: made.driftMs,
      file: ref('conformed', key, bytes, 'video/mp4', {
        width: made.width,
        height: made.height,
        duration: input.plan.duration,
        frameRate: input.plan.frameRate.output,
      }),
    }),
  );
}

export async function enforceCache(
  input: EnforceCacheCapJobInput,
  host: Phase2Host,
): AsyncResult<EnforceCacheCapJobOutput> {
  if (!host.cache) return noCache();
  const result = await host.cache.enforceCap({
    offlineHashes: input.offlineHashes,
    pinned: input.pinned,
    capBytes: input.capBytes,
  });
  if (!result.ok) return result;
  return ok({
    evicted: [...result.value.keys],
    freedBytes: result.value.freedBytes,
    usageBytes: result.value.usageBytes,
  });
}
