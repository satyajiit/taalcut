// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: which set a placement belongs to. A job's designs go on one at a time: the first starts the graphic's set
 * and is in the video; each later one joins that set. `workspace.placeOptions` takes no flag for it, so a weak
 * model cannot get it wrong: a call is the same job's when this run started the set and the request is the same.
 * Another run on the same graphic (a "try again"), another request, or graphics that carry no such set start over.
 */
import type { GraphicItem, GraphicOptions, Timeline } from '@taalcut/core';
import { graphicsIn } from '../../compositions/options';

export const secondsOf = (item: GraphicItem) =>
  (item.start.value * item.start.rate.den) / item.start.rate.num;

/** The set a job's later design joins, with its graphics. */
export interface JobSet {
  readonly set: GraphicOptions;
  readonly graphics: readonly GraphicItem[];
}

/**
 * The set this placement belongs to, when the same job already started one: a set this run started (`started`)
 * for the same request, carried by the graphics named, or, for a new graphic, the one placed nearest `start`.
 * Undefined starts a set: a new job, or another run's "try again" on the same graphic.
 */
export function jobSet(
  timeline: Timeline,
  job: { readonly request: string; readonly itemIds?: readonly string[] | undefined; readonly start: number },
  started: ReadonlySet<string> | undefined,
): JobSet | undefined {
  const mine = graphicsIn(timeline.tracks).filter(
    (item) => item.options && started?.has(item.options.set) && item.options.request === job.request,
  );
  const of = (set: GraphicOptions): JobSet => ({
    set,
    graphics: mine.filter((item) => item.options!.set === set.set),
  });
  if (job.itemIds) {
    const named = mine.filter((item) => job.itemIds!.includes(item.id));
    const set = named[0]?.options;
    if (!set || named.length !== job.itemIds.length || named.some((item) => item.options!.set !== set.set))
      return undefined;
    return of(set);
  }
  const nearest = [...mine].sort(
    (a, b) => Math.abs(secondsOf(a) - job.start) - Math.abs(secondsOf(b) - job.start),
  )[0];
  return nearest ? of(nearest.options!) : undefined;
}
