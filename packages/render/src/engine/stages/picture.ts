// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The picture, GPU first: Chrome's GPU raster (Metal on a Mac, ANGLE on Vulkan on Linux) and the hardware encoder
 * media chose (h264_videotoolbox, h264_nvenc); each CPU route only after its GPU one fails, or up front when the
 * machine has none or hardware is turned off (`disabled`), reported as compute.fallback. Conform and capture
 * progress feed the bar.
 */
import { ok, type AsyncResult, type ComputeBackend, type ComputeFallbackEvent } from '@taalcut/core';
import { machineVideoBackends, type MediaContext } from '@taalcut/media';
import type { ExportInputs } from '../export-inputs';
import { renderVideo, type RenderedVideo, type RenderVideoInput } from '../render-video';
import { encoderFor, platformGpu, wantedFor } from '../video-route';
import type { StageContext } from './context';

/** What the Phase 3 stages add to the picture: framing, the Style, and the grade on each segment. */
export type PictureExtras = Pick<RenderVideoInput, 'compose' | 'geometry' | 'afterConform'>;

/** core's name for Chrome's GPU raster: Metal on a Mac, Vulkan (ANGLE) elsewhere. */
export function rasterWanted(platform: NodeJS.Platform = process.platform): ComputeBackend[] {
  return platformGpu(platform);
}

/** How the picture starts: Chrome's raster, and the producer's encoder (none: the CPU route's ProRes mezzanine). */
export interface PictureRoute {
  readonly browserGpu: 'hardware' | 'software';
  readonly gpuEncoder: string | undefined;
  /** The CPU choices made before the run, one compute.fallback each. */
  readonly fallbacks: readonly ComputeFallbackEvent[];
}

/** The first route: media's working H.264 encoder at the preset's size, and the raster the machine allows. */
export async function planPicture(
  ctx: MediaContext,
  size: { readonly width: number; readonly height: number },
  signal?: AbortSignal,
): AsyncResult<PictureRoute> {
  const machine = await machineVideoBackends(ctx, signal);
  if (!machine.ok) return machine;
  const encoder = await encoderFor(ctx, 'h264', size, 'render.encode', signal);
  if (!encoder.ok) return encoder;
  const fallbacks: ComputeFallbackEvent[] = [];
  const disabled = machine.value.disabled;
  if (disabled)
    fallbacks.push({
      operation: 'render.capture',
      wanted: rasterWanted(ctx.platform),
      reason: 'disabled',
      detail: disabled,
    });
  if (encoder.value.fallback) fallbacks.push(encoder.value.fallback);
  return ok({
    browserGpu: disabled ? 'software' : 'hardware',
    gpuEncoder: encoder.value.fallback ? undefined : encoder.value.choice.encoder,
    fallbacks,
  });
}

/** Chrome that can't start its sandbox fails the same on SwiftShader: no retry, the reason goes to the user. */
const SANDBOX_REFUSED = /No usable sandbox|setuid sandbox|namespace sandbox/i;

export async function renderPicture(
  stage: StageContext,
  inputs: ExportInputs,
  chromePath: string,
  extras: PictureExtras,
): AsyncResult<RenderedVideo> {
  const { deps, tracker, signal } = stage;
  const planned = await planPicture(deps.media, inputs.preset, signal);
  if (!planned.ok) return planned;
  for (const event of planned.value.fallbacks) stage.fallback(event);
  let capturing = false;
  const run = (browserGpu: 'hardware' | 'software', gpuEncoder: string | undefined) =>
    renderVideo({
      timeline: inputs.timeline,
      preset: inputs.preset,
      burnCaptions: stage.record.captions.burnIn,
      source: (visual) => inputs.sources.get(visual.id),
      ctx: deps.media,
      conformDir: deps.folders.conform,
      workDir: stage.workDir,
      chromePath,
      browserGpu,
      gpuEncode: gpuEncoder !== undefined,
      ...(gpuEncoder ? { gpuEncoder } : {}),
      workers: deps.workers ?? 'auto',
      fonts: inputs.fonts,
      captionLayout: inputs.captionLayout,
      signal,
      ...extras,
      onConform: (done, total) => {
        tracker.within(done / total, { completed: done, total, unit: 'items' });
        if (done === total) tracker.stage('composing');
      },
      onCapture: (progress) => {
        if (!capturing) {
          capturing = true;
          tracker.stage('capturing');
        }
        if (progress.done !== undefined && progress.total)
          tracker.within(progress.done / progress.total, {
            completed: progress.done,
            total: progress.total,
            unit: 'frames',
          });
      },
      onFallback: stage.fallback,
      ...(deps.log ? { log: deps.log } : {}),
    });
  tracker.stage('conforming');
  const { browserGpu, gpuEncoder } = planned.value;
  deps.log?.(
    `[render] picture: raster ${browserGpu}, encode ${gpuEncoder ?? 'ProRes mezzanine (platform CPU encoder at finishing)'}`,
  );
  let picture = await run(browserGpu, gpuEncoder);
  if (
    !picture.ok &&
    picture.error.code === 'render.capture_failed' &&
    browserGpu === 'hardware' &&
    !SANDBOX_REFUSED.test(picture.error.detail ?? '') &&
    !signal.aborted
  ) {
    stage.fallback({
      operation: 'render.capture',
      wanted: rasterWanted(deps.media.platform),
      reason: 'accelerator_failed',
      detail: (picture.error.detail ?? '').slice(0, 2000),
    });
    picture = await run('software', gpuEncoder);
  }
  if (
    !picture.ok &&
    picture.error.code === 'render.encode_failed' &&
    gpuEncoder !== undefined &&
    !signal.aborted
  ) {
    stage.fallback({
      operation: 'render.encode',
      wanted: wantedFor(deps.media, 'encode'),
      reason: 'accelerator_failed',
      detail: (picture.error.detail ?? '').slice(0, 2000),
    });
    picture = await run('software', undefined);
  }
  return picture;
}
