// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Sound-effect errors (SPEC P3.6). */
import { defineError } from '@taalcut/core';

/** The `sfx-pack` component isn't installed (or its catalogue doesn't parse). */
export const SfxPackMissing = defineError('audio.sfx_pack_missing');
/** A cut index the timeline doesn't have. */
export const CutUnknown = defineError<{ cutIndex: number }>('audio.cut_unknown');
/**
 * EAR1-R2: `sfx.addHits` with bank sounds or a kit found no cut its sounds fit (no cut of their kinds, or none the
 * density keeps): refused, so an empty `sfx.setHits` never clears the effects already there.
 */
export const SfxNoFittingCuts = defineError('audio.sfx_no_fitting_cuts');
