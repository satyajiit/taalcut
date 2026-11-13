// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ExportPreset } from '@taalcut/core';
import { presetFor } from '../../src/presets/presets.v1';

/** The approved typography crops and pop negative controls were authored in this narrow cross-post box. */
export const LEGACY_CAPTION_PRESET: ExportPreset = {
  ...presetFor('device'),
  width: 1080,
  height: 1920,
  safe: { x: 120, y: 288, width: 660, height: 960 },
  captionAnchorY: 0.58,
};

/** A DOM probe is reusable only when every input to caption positioning and wrapping is identical. */
export function captionGeometryGroups(presets: readonly ExportPreset[]) {
  const groups = new Map<string, { drawn: ExportPreset; checked: ExportPreset[] }>();
  for (const preset of presets) {
    const { width, height, safe, captionAnchorY } = preset;
    const key = JSON.stringify([width, height, safe.x, safe.y, safe.width, safe.height, captionAnchorY]);
    const group = groups.get(key);
    if (group) group.checked.push(preset);
    else groups.set(key, { drawn: preset, checked: [preset] });
  }
  return [...groups.values()];
}
