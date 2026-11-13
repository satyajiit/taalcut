// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { exportPresetSchema, type ExportPreset } from '@taalcut/core';
import { titleSafe } from './presets.v1';

/** Device copies keep the document's canvas. Explicit platform/landscape presets remain intentional conversions. */
export function canvasPreset(preset: ExportPreset, canvas: { width: number; height: number }): ExportPreset {
  if (
    !['device', 'deviceHevc', 'deviceAv1'].includes(preset.id) ||
    (preset.width === canvas.width && preset.height === canvas.height)
  )
    return preset;
  // Older canvases may be odd-sized. 4:2:0 encoders need even dimensions;
  // the output rounds up by at most one pixel, using the same geometry in preview and capture.
  const width = Math.ceil(canvas.width / 2) * 2;
  const height = Math.ceil(canvas.height / 2) * 2;
  return exportPresetSchema.parse({
    ...preset,
    width,
    height,
    safe: titleSafe(width, height),
    overlays: [],
    captionAnchorY: 0.85,
    safeZoneCheckedOn: null,
  });
}
