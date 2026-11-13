// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The filmstrip sprite (UX2: its own job and index stage, media.filmstrip): one FFmpeg run over the copy to play
 * (`alreadyNormalised`: the proxy, upright and tone-mapped already, read by its keyframes since IX2-T3) or over the
 * original when it is its own proxy. The layout (filmstrip.ts) says which frames and where; the caller keeps it.
 */
import { stat } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { reportDecodeRoute } from '../compute-report';
import type { DecodeProfile } from '../decode-routes/select-route';
import { retryOnSoftware } from '../decode-routes/software-retry';
import { FfmpegFailed } from '../errors';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import { resolveTone } from '../normalise/session';
import { settledPlan } from '../normalise/settled';
import type { NormalisationPlan } from '../normalise/types';
import { proxyRate } from '../proxy/ladder';
import { filmstripLayout, type FilmstripLayout } from './filmstrip';
import { spriteRead, type SpriteSource } from './filmstrip-sprite';

export interface FilmstripOptions {
  /** Where the JPEG goes. */
  readonly out: string;
  /** `source` is the proxy this package wrote (upright, SDR, on the proxy's frame rate). */
  readonly alreadyNormalised?: boolean;
  readonly signal?: AbortSignal;
  /** The hardware profile's decoder (IX2-T4). */
  readonly profile?: DecodeProfile;
}

export interface FilmstripResult {
  readonly layout: FilmstripLayout;
  readonly bytes: number;
  /** Keyframes of the proxy (IX2-T3) or the exact frames. */
  readonly source: SpriteSource;
}

/** The sprite's size, or `media.ffmpeg_failed` when FFmpeg left nothing there. */
async function sizeOf(path: string): AsyncResult<number> {
  try {
    return ok((await stat(path)).size);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'filmstrip missing';
    return err(FfmpegFailed({ exitCode: -1 }, { detail }));
  }
}

export async function makeFilmstrip(
  source: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: FilmstripOptions,
): AsyncResult<FilmstripResult> {
  const working = options.alreadyNormalised ? settledPlan(plan, proxyRate(plan)) : plan;
  const layout = filmstripLayout(working);
  const tone = await resolveTone(working, ctx, options.signal);
  if (!tone.ok) return tone;
  reportDecodeRoute(ctx, tone.value.plan.decode);
  const sprite = await retryOnSoftware(tone.value.plan, ctx, async (attempt) => {
    const read = spriteRead(source, attempt, tone.value.tone, layout, {
      proxy: Boolean(options.alreadyNormalised),
      ...(options.profile ? { profile: options.profile } : {}),
    });
    const run = await runFfmpeg(ctx, ['-y', ...read.args, '-q:v', '3', '-update', '1', options.out], {
      holdsVideoSession: read.holdsVideoSession,
      timeoutMs: 180_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return run.ok ? ok(read.source) : run;
  });
  if (!sprite.ok) return sprite;
  const bytes = await sizeOf(options.out);
  if (!bytes.ok) return bytes;
  return ok({ layout, bytes: bytes.value, source: sprite.value });
}
