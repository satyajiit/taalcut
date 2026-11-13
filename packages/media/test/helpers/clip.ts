// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Encode a throwaway clip and turn a real file into a normalisation plan. */
import { stat } from 'node:fs/promises';
import { ok, type Result } from '@taalcut/core';
import {
  detectEncoders,
  hardwareBackends,
  hardwareEncoderFor,
  planNormalisation,
  probeMedia,
  runFfmpeg,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';

export async function h264Encoder(ctx: MediaContext): Promise<string[] | undefined> {
  const found = await detectEncoders(ctx);
  if (!found.ok) return undefined;
  const name = ['libopenh264', 'h264_videotoolbox', 'libx264'].find((item) =>
    found.value.encoders.some((encoder) => encoder.name === item),
  );
  return name ? ['-c:v', name, '-pix_fmt', 'yuv420p'] : undefined;
}

/**
 * This platform's hardware HEVC encoder when the build has it (hevc_videotoolbox on a Mac, hevc_nvenc on Linux):
 * the LGPL builds have no CPU HEVC encoder, so HEVC sources are made on it.
 */
export async function hardwareHevcEncoder(ctx: MediaContext): Promise<string | undefined> {
  const found = await detectEncoders(ctx);
  if (!found.ok) return undefined;
  const name = hardwareBackends(ctx.platform ?? process.platform)
    .map((backend) => hardwareEncoderFor(backend, 'hevc'))
    .find((encoder) => encoder !== undefined);
  return name && found.value.encoders.some((encoder) => encoder.name === name) ? name : undefined;
}

export async function renderClip(ctx: MediaContext, out: string, args: readonly string[]): Promise<boolean> {
  const result = await runFfmpeg(ctx, ['-y', ...args, out], { timeoutMs: 240_000 });
  if (!result.ok) console.warn(`${out}: ${result.error.code}: ${result.error.detail ?? ''}`);
  return result.ok;
}

export async function planClip(path: string, ctx: MediaContext): Promise<Result<NormalisationPlan>> {
  const probed = await probeMedia(path, ctx);
  if (!probed.ok) return probed;
  const size = await stat(path).then((info) => info.size);
  const plan = planNormalisation(probed.value, { sizeBytes: size });
  return plan.ok ? ok(plan.value) : plan;
}
