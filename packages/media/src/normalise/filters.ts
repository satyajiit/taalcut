// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Extra filters appended after the normalisation graph, on downloaded frames. */
import { framesExpression } from './frame-select';
import type { FilterGraph } from './graph';
import type { NormalisationPlan } from './types';

export function appendVideo(graph: FilterGraph, extra: string | undefined): FilterGraph {
  if (!extra) return graph;
  const videoFilter = graph.videoFilter ? `${graph.videoFilter},${extra}` : extra;
  return { ...graph, videoFilter };
}

export function appendAudio(graph: FilterGraph, extra: string | undefined): FilterGraph {
  if (!extra) return graph;
  const audioFilter = graph.audioFilter ? `${graph.audioFilter},${extra}` : extra;
  return { ...graph, audioFilter };
}

/**
 * `select` on the conformed grid, then a fresh timeline.
 * Without `setpts`, `-fps_mode cfr` duplicates each kept frame out to its old timestamp.
 * Any number of frames: past 32 the expression is a search FFmpeg can parse (frame-select.ts).
 */
export function selectFrames(indexes: readonly number[]): string {
  return `select='${framesExpression(indexes)}',setpts=N/FRAME_RATE/TB`;
}

/** Audio only: the graph's align filter, without decoding the picture. */
export function audioOnlyArgs(path: string, _plan: NormalisationPlan, graph: FilterGraph): string[] {
  const args: string[] = [];
  if (graph.seek) args.push('-ss', graph.seek);
  args.push('-i', path, '-vn', '-map', '0:a:0');
  if (graph.audioFilter) args.push('-af', graph.audioFilter);
  const limit = graph.tail.indexOf('-t');
  const duration = graph.tail[limit + 1];
  if (limit >= 0 && duration) args.push('-t', duration);
  return args;
}
