// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One keyframe-only FFmpeg read on a decode route (IX2-T2, IX2-T3): the
 * decoder skips every non-key picture (`-skip_frame nokey`, before the
 * hardware sees it), a `pick` (a `select`) chooses among the keyframes while
 * they are still on the device, and only the picked ones are turned upright,
 * tone-mapped, scaled and downloaded by the route's own filters, then
 * `finish` runs on the small frames (an `fps` grid, a `tile`). No frame-rate
 * conform: the frames keep their own timestamps. Frames are the same pictures
 * the route gives in a frame set, at the same size (`exactScale`).
 */
import type { ToneMapChoice } from '../backends';
import type { DecodeRoute } from '../decode-routes/route';
import { exactScale } from '../frame-sets/branch-graph';
import { fileInput, USER_MEDIA_INPUT } from '../input';
import { hdrFilters, targetSize, type GraphSize } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import type { KeyframeWindow } from './keyframe-windows';

export interface KeyframeGraphOptions {
  readonly route: DecodeRoute;
  readonly toneMap: ToneMapChoice;
  /** The picture size; undefined keeps the upright source size. */
  readonly size?: GraphSize;
  /** The seek and the stretch read; none reads the whole file. */
  readonly window?: KeyframeWindow;
  /** Filters on decoded keyframes before any picture work (a `select`). */
  readonly pick?: readonly string[];
  /** Filters on the finished frames. */
  readonly finish?: readonly string[];
}

/** Input options, `-i`, the video map and the `-vf` chain; the caller adds its output options. */
export function keyframeArgs(path: string, plan: NormalisationPlan, options: KeyframeGraphOptions): string[] {
  const { route, window } = options;
  const hdr = plan.toneMap === 'required' && options.toneMap.method !== 'none';
  const target = targetSize(plan, options.size, undefined);
  const filters = [
    ...(options.pick ?? []),
    ...route.shared(plan, hdr ? hdrFilters(plan, options.toneMap) : []),
    ...route.branch(plan, {
      ...(target ? { target } : {}),
      ...(exactScale(options.size) ? { exact: true } : {}),
      toned: hdr,
    }),
    ...(options.finish ?? []),
  ];
  return [
    ...route.inputArgs(plan),
    '-skip_frame',
    'nokey',
    ...(window ? ['-ss', window.start.toFixed(6), '-t', window.span.toFixed(6)] : []),
    ...USER_MEDIA_INPUT,
    '-i',
    fileInput(path),
    '-map',
    '0:V:0',
    '-an',
    '-vf',
    (filters.length > 0 ? filters : ['null']).join(','),
  ];
}
