// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every variant axis, by core's VARIANT_AXES id: the one place a new axis is listed (its module and an id in
 * core). The type makes the list complete: an id in core without a module here doesn't compile.
 */
import type { VariantAxis as VariantAxisId } from '@taalcut/core';
import type { VariantAxis } from './axis';
import { captionAxis } from './caption-axis';
import { hookAxis } from './hook-axis';
import { musicAxis } from './music-axis';

export const VARIANT_AXIS_MODULES: Readonly<Record<VariantAxisId, VariantAxis>> = {
  hook: hookAxis,
  music: musicAxis,
  captions: captionAxis,
};
