// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The software decoder: the route a plan takes when the hardware can't decode
 * the file (its fallback reason is already logged by `planDecode`). FFmpeg's
 * autorotate turns video upright; a still is turned (and un-mirrored) here.
 * Tone-map (once, before the split) and scale run on the CPU.
 */
import { imageFilters, scaleFilter } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import type { BranchPicture, DecodeRoute } from './route';

export const softwareRoute: DecodeRoute = {
  id: 'software',
  honoursSkipFrame: true,
  scalesOnDevice: false,
  holdsVideoSession: false,
  inputArgs: (plan: NormalisationPlan) =>
    plan.kind === 'image' && (plan.rotation !== 0 || plan.mirrored) ? ['-noautorotate'] : [],
  shared: (plan: NormalisationPlan, toneMap: readonly string[]) => [...imageFilters(plan), ...toneMap],
  branch(_plan: NormalisationPlan, picture: BranchPicture) {
    const { target } = picture;
    return target ? [scaleFilter(target.width, target.height, picture.exact)] : [];
  },
};
