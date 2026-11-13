// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { computeFallbackEvent, selectBackend } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';

/** Record the unsupported analysis kernels before starting the reference CPU implementations. */
export function reportVisualQaFallback(
  media: Pick<MediaContext, 'onComputeFallback'>,
  operation: 'vision.inspectCaptionZones' | 'vision.checkFrameQuality',
): void {
  const candidates = ['metal', 'webgpu', 'cpu'] as const;
  const choice = selectBackend(candidates, ['cpu'], {
    fallbackReason: 'no_accelerator',
    detail: 'Caption and visual QA reductions have no supported Metal or WebGPU kernel in this build',
  });
  if (!choice.ok || choice.value.backend !== 'cpu') throw new Error('CPU analysis backend unavailable');
  const event = computeFallbackEvent(operation, candidates, choice.value.fallback);
  if (media.onComputeFallback) media.onComputeFallback(event);
  else console.warn(`[vision] compute.fallback ${operation}: ${event.reason}; ${event.detail}`);
}
