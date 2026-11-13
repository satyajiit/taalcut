// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the decode service takes an analysis pass (IX2-V3): only where its frames are the frames
 * FFmpeg's VideoToolbox route gives. That is an 8-bit SDR H.264 or HEVC video, 4:2:0, decoded on
 * VideoToolbox to NV12, at normal speed on its own grid (no conform to repeat or drop frames), not
 * mirrored, scaled down for every output, with raw frame sets only. Anything else, and any option this
 * route doesn't know (a branch another change adds), stays on FFmpeg's decode. The service still checks
 * each frame against the grid and declines a stream of another range before it writes a frame.
 */
import { pictureDecline, streamRange } from '../decode-service/eligible';
import { serviceFor } from '../decode-service/switch';
import type { DecodeService } from '../decode-service/types';
import { targetSize, type GraphTarget } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import type { AnalysisPassOptions, PassFrameSet } from './pass-types';

export { streamRange } from '../decode-service/eligible';

export interface HelperPassPlan {
  readonly service: DecodeService;
  readonly analysis: GraphTarget;
  readonly sets: readonly { readonly set: PassFrameSet; readonly target: GraphTarget }[];
  readonly range: 'full' | 'video';
}

export type HelperChoice = { readonly use: HelperPassPlan } | { readonly decline: string };

/** The options this route reads. Another key, set, sends the pass to FFmpeg. */
const KNOWN_OPTIONS: ReadonlySet<string> = new Set([
  'size',
  'coarseEvery',
  'onFrame',
  'frameSets',
  'dir',
  'profile',
  'signal',
  'timeoutMs',
  'window',
  'detectMinSeconds',
  'decodeService',
  'rgbStream',
]);

export function helperChoice(
  path: string,
  plan: NormalisationPlan,
  options: AnalysisPassOptions,
): HelperChoice | undefined {
  // A service the switch gives frame reads only (IX2-F14) leaves the pass to FFmpeg without a word.
  const service = serviceFor(options.decodeService, 'pass');
  if (!service) return undefined;
  const unknown = Object.entries(options).find(
    ([key, value]) => value !== undefined && !KNOWN_OPTIONS.has(key),
  );
  if (unknown) return { decline: `option_${unknown[0]}` };
  const avoided = service.avoided(path);
  if (avoided !== undefined) return { decline: `avoided_${avoided}` };
  const picture = pictureDecline(plan);
  if (picture) return { decline: picture };
  const analysis = targetSize(plan, { longSide: options.size ?? 256 }, undefined);
  if (!analysis) return { decline: 'small_source' };
  const sets: { set: PassFrameSet; target: GraphTarget }[] = [];
  for (const set of (options.frameSets ?? []).filter((s) => s.maxFrames > 0)) {
    if (set.format !== 'rgb24' && set.format !== 'gray8') return { decline: `set_format_${set.format}` };
    const target = targetSize(plan, set.size, undefined);
    if (!target) return { decline: 'small_source' };
    sets.push({ set, target });
  }
  return { use: { service, analysis, sets, range: streamRange(plan) } };
}
