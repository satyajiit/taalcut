// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * D3D11VA (Windows GPUs without CUDA; not run on real hardware this round,
 * unit-tested on its arguments only). The decode runs on the GPU
 * (`-hwaccel d3d11va -hwaccel_output_format d3d11`); FFmpeg has no D3D11
 * scale or transpose filter (its D3D12 filters are deinterlace and motion
 * estimation only; https://ffmpeg.org/ffmpeg-filters.html, read 2026-10-17),
 * so every frame downloads once before the split (and tone-maps there for
 * HDR), and each branch scales and turns on the CPU: the turn follows the
 * scale, so the scale's size is the sideways one for 90° and 270°.
 */
import { scaleFilter, softwareRotate } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import {
  beforeTurn,
  downloadFormat,
  DROP_DISPLAY_MATRIX,
  type BranchPicture,
  type DecodeRoute,
} from './route';

export const d3d11vaRoute: DecodeRoute = {
  id: 'd3d11va',
  // An hwaccel on FFmpeg's own decoder, like NVDEC: non-key pictures are skipped while parsing.
  honoursSkipFrame: true,
  scalesOnDevice: false,
  holdsVideoSession: true,
  inputArgs: () => ['-noautorotate', '-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11'],
  shared: (plan: NormalisationPlan, toneMap: readonly string[]) => [
    DROP_DISPLAY_MATRIX,
    'hwdownload',
    `format=${downloadFormat(plan, toneMap.length > 0, 'nv12')}`,
    ...toneMap,
  ],
  branch(plan: NormalisationPlan, picture: BranchPicture) {
    const sideways = picture.target ? beforeTurn(plan, picture.target) : undefined;
    return [
      ...(sideways ? [scaleFilter(sideways.width, sideways.height, picture.exact)] : []),
      ...softwareRotate(plan.rotation),
      ...(plan.mirrored ? ['hflip'] : []),
    ];
  },
};
