// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A decoder whose frames stay on the device (a hw-video row that turns and scales there: VideoToolbox, CUDA,
 * VA-API): turned with its transpose filter before the split, scaled per branch with its scale filter, then
 * downloaded in the surface format the decoder produced. An HDR source downloads and tone-maps once before the
 * split, and its branches scale on the CPU. Every row's transpose takes the same directions as `transpose_vt`.
 */
import { downloadsDeep, scaleFilter } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import { hwDecoder, hwDownloadFilters, hwScaleFilter, hwUprightFilters } from '../hw-video/filters';
import type { HardwareBackend } from '../hw-video/types';
import type { BranchPicture, DecodeRoute } from './route';

export interface SurfaceRouteConfig {
  /** The row: its hwaccel, filters and download format. */
  readonly backend: HardwareBackend;
  /** The format frames download in: the plan's surface format, or one read from the plan (a profile's route). */
  readonly surfaceFormat: string | ((plan: NormalisationPlan) => string);
}

export function surfaceRoute({ backend, surfaceFormat }: SurfaceRouteConfig): DecodeRoute {
  const decode = hwDecoder(backend);
  const surfaceOf = (plan: NormalisationPlan) =>
    typeof surfaceFormat === 'string' ? surfaceFormat : surfaceFormat(plan);
  return {
    id: backend,
    honoursSkipFrame: decode.honoursSkipFrame,
    scalesOnDevice: true,
    holdsVideoSession: true,
    inputArgs: () => [
      '-noautorotate',
      '-hwaccel',
      decode.hwaccel,
      '-hwaccel_output_format',
      decode.outputFormat,
    ],
    shared(plan: NormalisationPlan, toneMap: readonly string[]) {
      const upright = hwUprightFilters(backend, plan.rotation);
      if (toneMap.length === 0) return upright;
      return [
        ...upright,
        ...hwDownloadFilters(backend, surfaceOf(plan), downloadsDeep(plan, true)),
        ...toneMap,
      ];
    },
    branch(plan: NormalisationPlan, picture: BranchPicture) {
      const { target } = picture;
      const filters: string[] = [];
      if (picture.toned) {
        if (target) filters.push(scaleFilter(target.width, target.height, picture.exact));
      } else {
        const scale = target ? hwScaleFilter(backend, target.width, target.height) : undefined;
        if (scale) filters.push(scale);
        filters.push(...hwDownloadFilters(backend, surfaceOf(plan), downloadsDeep(plan, false)));
      }
      // A mirror flips after the scale: the small frame.
      if (plan.mirrored) filters.push('hflip');
      return filters;
    },
  };
}
