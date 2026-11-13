// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One decode, several outputs: the file's video is decoded once on a decode
 * route, turned upright and conformed to the plan's grid (or a window of
 * it), then `split` into branches that each pick their frames, scale,
 * download and tone-map for their own size, and run their own filters
 * (scene scores, black and freeze detection). Frames of a branch are byte
 * for byte the frames `normalisationGraph` gives for the same size: the same
 * filters run on them, only the frame-rate conform moves before the scale,
 * which keeps the same frames (test/frame-sets/frame-sets.test.ts). One
 * difference: a CPU scale to a long side is exact (`exactScale`), so a frame
 * file always has the size it is indexed at. A branch's frames can also feed
 * taps (IX2-C3): further outputs that pick and filter those frames on the
 * CPU, so a small output costs no second device scale and download. A tap
 * reads them as the branch scaled and downloaded them, in colour: FFmpeg
 * converts an output's pixel format as early as it can, so a gray output (the
 * analysis frames) would grey the whole branch, the tap's frames included.
 * The branch's own path therefore starts with a `scale` that only converts, on one thread (IX2-F15,
 * normalise/one-thread.ts); on a route that scales on the device every scale in the graph does (the frames
 * reach the CPU at their size and only convert there), so the frames repeat run to run.
 */
import type { ToneMapChoice } from '../backends';
import type { DecodeRoute } from '../decode-routes/route';
import { fileInput, stillPipeDemuxer, USER_MEDIA_INPUT } from '../input';
import {
  conformFilters,
  hdrFilters,
  rangeSeek,
  targetSize,
  type GraphRange,
  type GraphSize,
} from '../normalise/graph';
import { framesExpression, selectedFrames } from '../normalise/frame-select';
import { CONVERT_ONE_THREAD, ONE_THREAD_SCALES } from '../normalise/one-thread';
import type { NormalisationPlan } from '../normalise/types';

/** Which frames of the grid (of the window, with a range) a branch keeps. */
export type FramePick = { readonly every: number } | { readonly frames: readonly number[] };

export interface GraphBranch {
  readonly size?: GraphSize;
  readonly pick?: FramePick;
  /** Filters on the branch's finished frames (analysis filters). */
  readonly filters?: readonly string[];
  /** More outputs from this branch's frames (before its filters, which only measure); labelled after every branch. */
  readonly taps?: readonly GraphTap[];
}

/** An output split off a branch's scaled, downloaded frames: its own pick (of those frames) and CPU filters. */
export interface GraphTap {
  readonly pick?: FramePick;
  readonly filters: readonly string[];
}

export interface BranchGraphOptions {
  readonly route: DecodeRoute;
  readonly toneMap: ToneMapChoice;
  readonly range?: GraphRange;
  readonly branches: readonly GraphBranch[];
}

export interface BranchGraph {
  /** Everything up to and including `-filter_complex`; each output adds `-map <label>` and its own options. */
  readonly args: readonly string[];
  /** `[o0]`, `[o1]`, … in branch order, then each branch's taps in order. */
  readonly outputs: readonly string[];
}

/**
 * `select` on the conformed grid, then a fresh timeline (`-fps_mode` would otherwise pad to the old timestamps).
 * Any number of frames: past 32 the expression is a search FFmpeg can parse (normalise/frame-select.ts).
 */
export function pickFilters(pick: FramePick | undefined): string[] {
  if (!pick) return [];
  if ('every' in pick) {
    const every = Math.max(1, Math.round(pick.every));
    return every > 1 ? [`select='not(mod(n\\,${every}))'`, 'setpts=N/FRAME_RATE/TB'] : [];
  }
  return [`select='${framesExpression(pick.frames)}'`, 'setpts=N/FRAME_RATE/TB'];
}

/** The indexes a pick keeps, in output order, for `frames` frames of input (every-n picks only need the count). */
export function pickedFrames(pick: FramePick | undefined, frames: number): number[] {
  if (pick && 'frames' in pick) {
    return selectedFrames(pick.frames)
      .sort((a, b) => a - b)
      .filter((index) => index < frames);
  }
  const every = pick ? Math.max(1, Math.round(pick.every)) : 1;
  const out: number[] = [];
  for (let index = 0; index < frames; index += every) out.push(index);
  return out;
}

/**
 * Whether a branch scales to exactly its target. A long side's target is already the picture's aspect, rounded
 * to even sides, and a frame file is read at exactly that size: a CPU scale that only fits inside it
 * (`force_original_aspect_ratio=decrease`, the software decoder and tone-mapped HDR) can come out a few pixels
 * narrower (1920×1080 at 400: 398×224 against 400×224) and leave the file unreadable. The device scalers
 * (`scale_vt`, `scale_cuda`) always scale exactly, so every route now gives the same size.
 */
export function exactScale(size: GraphSize | undefined): boolean {
  return size?.exact === true || size?.longSide !== undefined;
}

export function branchGraph(path: string, plan: NormalisationPlan, options: BranchGraphOptions): BranchGraph {
  const { route, branches } = options;
  const hdr = plan.toneMap === 'required' && options.toneMap.method !== 'none';
  const toneMap = hdr ? hdrFilters(plan, options.toneMap) : [];
  const { seek } = rangeSeek(plan, options.range);
  const shared = [
    ...route.shared(plan, toneMap),
    ...conformFilters(plan, plan.frameRate.output, options.range),
  ];
  const count = branches.length;
  const splitLabels = branches.map((_, i) => `[s${i}]`).join('');
  const head = [...(shared.length > 0 ? shared : ['null']), ...(count > 1 ? [`split=${count}`] : [])];
  const parts = [`[0:V:0]${head.join(',')}${splitLabels}`];
  const tapParts: string[] = [];
  let outputs = count;
  branches.forEach((branch, i) => {
    const target = targetSize(plan, branch.size, undefined);
    const frames = [
      ...pickFilters(branch.pick),
      ...route.branch(plan, {
        ...(target ? { target } : {}),
        ...(exactScale(branch.size) ? { exact: true } : {}),
        toned: hdr,
      }),
    ];
    const taps = branch.taps ?? [];
    if (taps.length === 0) {
      const filters = [...frames, ...(branch.filters ?? [])];
      parts.push(`[s${i}]${(filters.length > 0 ? filters : ['null']).join(',')}[o${i}]`);
    } else {
      const tapLabels = taps.map((_, j) => `[t${i}_${j}]`).join('');
      parts.push(`[s${i}]${[...frames, `split=${taps.length + 1}`].join(',')}[b${i}]${tapLabels}`);
      parts.push(`[b${i}]${[CONVERT_ONE_THREAD, ...(branch.filters ?? [])].join(',')}[o${i}]`);
    }
    taps.forEach((tap, j) => {
      const chain = [...pickFilters(tap.pick), ...tap.filters];
      tapParts.push(`[t${i}_${j}]${(chain.length > 0 ? chain : ['null']).join(',')}[o${outputs}]`);
      outputs += 1;
    });
  });
  const still = stillPipeDemuxer(path);
  // Frames downloaded at their size only convert on the CPU: on one thread, so they repeat (IX2-F15).
  const oneThread = route.scalesOnDevice && !hdr ? ONE_THREAD_SCALES : '';
  return {
    args: [
      ...route.inputArgs(plan),
      ...(seek !== undefined ? ['-ss', seek] : []),
      ...USER_MEDIA_INPUT,
      ...(still ? ['-f', still] : []),
      '-i',
      fileInput(path),
      '-filter_complex',
      `${oneThread}${[...parts, ...tapParts].join(';')}`,
    ],
    outputs: Array.from({ length: outputs }, (_, i) => `[o${i}]`),
  };
}
