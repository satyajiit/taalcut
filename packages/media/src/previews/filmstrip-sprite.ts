// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The filmstrip sprite's FFmpeg arguments, one run either way. From the
 * proxy (IX2-T3) the tiles come from its keyframes alone: the proxy is
 * written with a closed GOP of half a second (proxy/ladder.ts `gopSize`), so
 * each tile shows the last keyframe at or before its time, at most one GOP
 * earlier, and only those pictures are decoded and scaled. FFmpeg's `fps`
 * filter puts them on the tiles' grid (`round=up`: the latest frame at or
 * before each tile), repeating a keyframe where two tiles fall in one GOP and
 * the last keyframe after the end (`tpad`). Tiles closer together than a GOP,
 * a file whose keyframes we don't know (an original read in place of a
 * proxy) and a decoder that can't skip to keyframes read the exact grid
 * frames, as before IX2.
 */
import type { ToneMapChoice } from '../backends';
import { decodeRouteFor, type DecodeProfile } from '../decode-routes/select-route';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import { keyframeArgs } from '../keyframes/keyframe-graph';
import { appendVideo, selectFrames } from '../normalise/filters';
import { graphInputArgs, normalisationGraph } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import { gopSize } from '../proxy/ladder';
import type { FilmstripLayout } from './filmstrip';

export type SpriteSource = 'keyframes' | 'exact';

export interface SpriteRead {
  /** Up to and including the filters; the caller adds the JPEG options and the output. */
  readonly args: readonly string[];
  readonly source: SpriteSource;
  /** The read's decode may hold a hardware video session (the end policy, IX3-K2). */
  readonly holdsVideoSession: boolean;
}

export interface SpriteOptions {
  /** `source` is the proxy this package wrote, so its keyframe spacing is known. */
  readonly proxy: boolean;
  readonly profile?: DecodeProfile;
}

/**
 * Seconds between neighbouring tiles when every tile is at least one proxy GOP after the one before;
 * undefined otherwise (a short clip, one tile).
 */
export function keyframeTileSpacing(plan: NormalisationPlan, layout: FilmstripLayout): number | undefined {
  const count = layout.tiles.length;
  const rate = plan.frameRate.output.num / plan.frameRate.output.den;
  if (count < 2 || !(rate > 0)) return undefined;
  const spacing = (Math.max(1, plan.frames) - 1) / (count - 1) / rate;
  const gop = gopSize(rate) / rate;
  return spacing >= gop ? spacing : undefined;
}

/** `fps` on the tiles' grid: tick k is tile k's time, (frames − 1) / (count − 1) grid frames apart. */
function tileGrid(plan: NormalisationPlan, layout: FilmstripLayout): string {
  const { num, den } = plan.frameRate.output;
  const ticks = `${(layout.tiles.length - 1) * num}/${(Math.max(1, plan.frames) - 1) * den}`;
  return `fps=fps=${ticks}:round=up`;
}

export function spriteRead(
  source: string,
  plan: NormalisationPlan,
  toneMap: ToneMapChoice,
  layout: FilmstripLayout,
  options: SpriteOptions,
): SpriteRead {
  const route = decodeRouteFor(plan, options.profile);
  const tile = `tile=${layout.columns}x${layout.rows}`;
  if (options.proxy && route.honoursSkipFrame && keyframeTileSpacing(plan, layout) !== undefined) {
    const args = keyframeArgs(source, plan, {
      route,
      toneMap,
      size: { width: layout.tileWidth, height: layout.tileHeight, exact: true },
      finish: [
        'setpts=PTS-STARTPTS',
        // Tiles after the last keyframe repeat it: clones until the grid has every tile.
        'tpad=stop_mode=clone:stop=-1',
        tileGrid(plan, layout),
        `trim=end_frame=${layout.tiles.length}`,
        tile,
      ],
    });
    return {
      args: [...args, '-frames:v', '1', '-fps_mode', 'passthrough'],
      source: 'keyframes',
      holdsVideoSession: route.holdsVideoSession,
    };
  }
  const graph = appendVideo(
    normalisationGraph(plan, {
      route: plan.decode,
      toneMap,
      size: { width: layout.tileWidth, height: layout.tileHeight },
    }),
    `${selectFrames(layout.tiles.map((t) => t.frame))},${tile}`,
  );
  return {
    args: graphInputArgs(source, plan, graph, true),
    source: 'exact',
    holdsVideoSession: decodeHoldsVideoSession(plan.decode),
  };
}
