// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CPU choices for Phase 2 go through core's selectBackend and emit
 * compute.fallback. Analysis filters and the tone-map are once per process:
 * the filters have no GPU path, and the tone-map trial is cached.
 */
import {
  computeFallbackEvent,
  cpuFallback,
  selectBackend,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type ComputeFallbackReason,
} from '@taalcut/core';
import type { FallbackCode, MediaBackend } from './backends';
import type { MediaContext } from './ffmpeg';
import { backendOfEncoder, hardwareBackends, hwVideoBackend } from './hw-video/table';

type PlatformContext = Pick<MediaContext, 'onComputeFallback' | 'platform'>;

/** The compute names of the platform's default rows, for one side: what a CPU route was wanted instead of. */
function wantedFor(ctx: Pick<MediaContext, 'platform'>, side: 'decode' | 'encode'): ComputeBackend[] {
  const ids = hardwareBackends(ctx.platform ?? process.platform).filter((id) => hwVideoBackend(id)[side]);
  return [...new Set(ids.map((id) => hwVideoBackend(id).compute[side]))];
}

const lifetime = new Set<string>();

/** Tests reset the once-per-process record. */
export function resetComputeFallbackLog(): void {
  lifetime.clear();
}

export function mapFallbackCode(code: FallbackCode): ComputeFallbackReason {
  switch (code) {
    case 'requested':
      return 'disabled';
    case 'codec_unsupported':
    case 'format_unsupported':
      return 'unsupported_input';
    case 'hardware_failed':
      return 'accelerator_failed';
    case 'no_hardware_backend':
    case 'encoder_missing':
    case 'filter_missing':
    case 'vulkan_unavailable':
      return 'no_accelerator';
    default:
      return 'no_accelerator';
  }
}

export function emitComputeFallback(
  listener: ((event: ComputeFallbackEvent) => void) | undefined,
  operation: string,
  wanted: readonly ComputeBackend[],
  reason: ComputeFallbackReason,
  detail?: string,
  once = false,
): void {
  if (once && lifetime.has(operation)) return;
  if (once) lifetime.add(operation);
  const choice = selectBackend([...wanted, 'cpu'], (backend) => backend === 'cpu', {
    fallbackReason: reason,
    ...(detail === undefined ? {} : { detail }),
  });
  if (!choice.ok || choice.value.backend !== 'cpu') return;
  const event = computeFallbackEvent(operation, [...wanted, 'cpu'], choice.value.fallback);
  if (!listener) {
    console.warn(`[media] compute.fallback ${event.operation}: ${event.reason}`);
    return;
  }
  try {
    listener(event);
  } catch (cause) {
    console.error('[media] compute fallback listener threw', cause);
  }
}

/** Confirms a hardware row's decode, or records the software route against the rows the platform wanted. */
export function reportDecodeRoute(
  ctx: PlatformContext,
  route: { readonly backend: MediaBackend; readonly fallbackReason?: { code: FallbackCode; detail: string } },
): void {
  if (route.backend !== 'software') {
    const name = hwVideoBackend(route.backend).compute.decode;
    selectBackend([name, 'cpu'], [name, 'cpu']);
    return;
  }
  const reason = route.fallbackReason;
  emitComputeFallback(
    ctx.onComputeFallback,
    'media.decode',
    wantedFor(ctx, 'decode'),
    reason ? mapFallbackCode(reason.code) : 'no_accelerator',
    reason?.detail,
  );
}

/** HDR tone-map landed on the CPU. Once per process, operation `media.toneMap`. */
export function reportToneMapCpu(
  ctx: Pick<MediaContext, 'onComputeFallback'>,
  code: FallbackCode,
  detail: string,
): void {
  emitComputeFallback(ctx.onComputeFallback, 'media.toneMap', ['vulkan'], mapFallbackCode(code), detail, true);
}

/**
 * scdet, blackdetect, freezedetect, ebur128, ssim and thumbnail have no usable GPU path on the decoder's frames
 * (VideoToolbox's, CUDA's). One record per process.
 */
export function reportAnalysisFilters(ctx: PlatformContext): void {
  const wanted = wantedFor(ctx, 'decode');
  const labels = hardwareBackends(ctx.platform ?? process.platform).flatMap((id) => {
    const label = hwVideoBackend(id).decode?.label;
    return label ? [label] : [];
  });
  emitComputeFallback(
    ctx.onComputeFallback,
    'media.analysisFilters',
    wanted,
    'no_accelerator',
    `no ${labels.join(' or ') || 'GPU'} implementation of the analysis filters`,
    true,
  );
}

/**
 * Encoder choice. A hardware row's encoder (`chosenName`) is the GPU route; anything else is a logged CPU
 * fallback, wanted against `hardwareName`'s row (the encoder it moved off), else the platform's encoder rows;
 * `code` is the choice's fallback code (default: the hardware failed when run).
 */
export function reportEncoderChoice(
  ctx: PlatformContext,
  operation: string,
  hardwareName: string | undefined,
  chosenName: string,
  detail?: string,
  code?: FallbackCode,
): void {
  const chosen = backendOfEncoder(chosenName);
  if (chosen) {
    selectBackend([chosen.compute.encode, 'cpu'], [chosen.compute.encode, 'cpu']);
    return;
  }
  const from = hardwareName ? backendOfEncoder(hardwareName) : undefined;
  const wanted = from ? [from.compute.encode] : wantedFor(ctx, 'encode');
  const reason = code ? mapFallbackCode(code) : 'accelerator_failed';
  emitComputeFallback(ctx.onComputeFallback, operation, wanted, reason, detail);
}

export { cpuFallback };
