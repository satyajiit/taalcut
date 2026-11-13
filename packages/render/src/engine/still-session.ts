// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AsyncResult, ExportPreset, Timeline } from '@taalcut/core';
import { openCaptureSession, type CaptureHandle } from './capture';
import type { RenderEngineDeps } from './deps';
import { platformGpu } from './video-route';

export async function openStillSession(
  deps: RenderEngineDeps,
  dir: string,
  timeline: Timeline,
  preset: ExportPreset,
): AsyncResult<CaptureHandle> {
  const shell = await deps.shell();
  if (!shell.ok) return shell;
  const options = {
    dir,
    rate: timeline.canvas.rate,
    width: preset.width,
    height: preset.height,
    chromePath: shell.value,
    binaries: deps.media.binaries,
  };
  const hardware = await openCaptureSession({ ...options, browserGpu: 'hardware' });
  if (hardware.ok) return hardware;
  // GPU first (ADR 0002): the software rasteriser only after the GPU raster failed, and said so.
  const report = deps.onFallback ?? ((event) => deps.events.emit('compute.fallback', event));
  report({
    operation: 'render.captureFrame',
    wanted: platformGpu(deps.media.platform),
    reason: 'accelerator_failed',
    detail: (hardware.error.detail ?? hardware.error.code).slice(0, 2000),
  });
  return openCaptureSession({ ...options, browserGpu: 'software' });
}
