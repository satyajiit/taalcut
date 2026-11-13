// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Realness as F7's analysis plugs it in (analysis/extensions.ts `RealnessScorer`): the models' mono through CLAP,
 * core's SoundRealness out (a silent sound reports itself as `silent`); null when no model runs.
 */
import { ok } from '@taalcut/core';
import type { RealnessScorer } from '../analysis/hooks';
import { realnessOf, toSoundRealness } from './realness';

export function createRealnessScorer(): RealnessScorer {
  return async (input) => {
    if (!input.models) return ok(null);
    const r = await realnessOf(
      input.source.samples,
      input.models.clap,
      input.signal ? { signal: input.signal } : {},
    );
    return r.ok ? ok(toSoundRealness(r.value)) : r;
  };
}
