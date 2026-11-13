// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the recipe this platform's subject tracks have, part of every track's key: the mac helper's on a Mac, the
 * ONNX detector's elsewhere (render-subjects-onnx.ts). Its own module, so the stores' processes don't load vision.
 */
import { ONNX_TRACK_RECIPE, TRACK_RECIPE } from '@taalcut/render';
import { hostPlatform, type PlatformAbilities } from '../../platform';

export const subjectRecipe = (
  abilities: Pick<PlatformAbilities, 'nativeSubjects'> = hostPlatform().abilities,
) => (abilities.nativeSubjects ? TRACK_RECIPE : ONNX_TRACK_RECIPE);
