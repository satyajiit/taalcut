// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: what a set of designs needs of a timeline, as pure functions. A graphic placed with options is in the video,
 * drawn with one design; it names the others by their compositions, whose copies the timeline keeps like the one in
 * use. Choosing redraws every graphic of the set with another design and keeps each graphic's own words. The
 * timeline keeps at most `MAX_TIMELINE_COMPOSITIONS` copies: when designs in use and options together would pass it,
 * the oldest sets stop being a choice (their graphics stay as they are, drawn with the design in use).
 */
import {
  compositionFor,
  MAX_TIMELINE_COMPOSITIONS,
  type GraphicComposition,
  type GraphicItem,
  type GraphicOptions,
  type TextTrackItem,
  type Timeline,
} from '@taalcut/core';

type Tracks = Timeline['tracks'];
type Params = Readonly<Record<string, string | number | boolean>>;

/** Every text track item, in track order. */
export function textTrackItems(tracks: Tracks): TextTrackItem[] {
  return tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));
}

/** The graphics among them. */
export const graphicsIn = (tracks: Tracks): GraphicItem[] =>
  textTrackItems(tracks).filter((item): item is GraphicItem => item.type === 'graphic');

/** The newest copy of a design the timeline keeps (its highest version), or undefined. */
export function newestCopy(
  id: string,
  compositions: readonly GraphicComposition[] | undefined,
): GraphicComposition | undefined {
  return (compositions ?? []).filter((copy) => copy.id === id).sort((a, b) => b.version - a.version)[0];
}

/** A composition's word variables by name, sorted: what every design of a set must share. */
export const wordNames = (composition: GraphicComposition): string[] =>
  composition.variables
    .filter((variable) => variable.type === 'text')
    .map((variable) => variable.name)
    .sort();

/** `ids` with every graphic that shares a set with one of them, in track order after the ones named. */
export function withSetMates(tracks: Tracks, ids: readonly string[]): string[] {
  const graphics = graphicsIn(tracks);
  const sets = new Set(
    graphics
      .filter((item) => ids.includes(item.id) && item.options)
      .map((item) => item.options!.set as string),
  );
  const mates = graphics.filter((item) => item.options && sets.has(item.options.set)).map((item) => item.id);
  return [...new Set([...ids, ...mates])];
}

/**
 * A graphic's values under another design: the ones the design names, and its words carried over when both designs
 * have a single word variable under different names (a design changed since the set was made).
 */
export function carriedParams(
  params: Params,
  from: GraphicComposition | undefined,
  to: GraphicComposition,
): Record<string, string | number | boolean> {
  const names = new Set(to.variables.map((variable) => variable.name));
  const kept = Object.fromEntries(Object.entries(params).filter(([name]) => names.has(name)));
  const [word, ...moreWords] = wordNames(to);
  const [was, ...moreWas] = from ? wordNames(from) : [];
  if (word && moreWords.length === 0 && was && moreWas.length === 0 && kept[word] === undefined) {
    const words = params[was];
    if (words !== undefined) kept[word] = words;
  }
  return kept;
}

/** The graphic drawn with `to` from now on, keeping its place, its time and its words. */
export function drawnWith(item: GraphicItem, timeline: Timeline, to: GraphicComposition): GraphicItem {
  const from =
    compositionFor(item.composition, timeline.graphicCompositions) ??
    newestCopy(item.composition.id, timeline.graphicCompositions);
  return {
    ...item,
    composition: { id: to.id, hash: to.hash, params: carriedParams(item.composition.params, from, to) },
  };
}

/** `id@hash` of every copy a graphic is drawn with, and the ids of every design a set offers. */
export function namedDesigns(tracks: Tracks): { readonly drawn: Set<string>; readonly offered: Set<string> } {
  const drawn = new Set<string>();
  const offered = new Set<string>();
  for (const item of graphicsIn(tracks)) {
    drawn.add(`${item.composition.id}@${item.composition.hash}`);
    for (const design of item.options?.designs ?? []) offered.add(design.compositionId);
  }
  return { drawn, offered };
}

/** Whether a graphic names the copy: it is drawn with it, or one of its options is that design. */
export function isNamed(copy: GraphicComposition, named: ReturnType<typeof namedDesigns>): boolean {
  return named.drawn.has(`${copy.id}@${copy.hash}`) || named.offered.has(copy.id);
}

/** The tracks with the option sets `drop` names taken off their graphics (they stay, drawn as they are). */
function withoutSets(tracks: Tracks, drop: ReadonlySet<string>): Tracks {
  if (drop.size === 0) return tracks;
  return tracks.map((track) =>
    track.kind !== 'text'
      ? track
      : {
          ...track,
          items: track.items.map((item) => {
            if (item.type !== 'graphic' || !item.options || !drop.has(item.options.set)) return item;
            const { options: _closed, ...kept } = item;
            return kept;
          }),
        },
  );
}

/** The sets on the tracks, oldest first, leaving out `keep`. */
function oldestSets(tracks: Tracks, keep: string | undefined): GraphicOptions[] {
  const sets = new Map<string, GraphicOptions>();
  for (const item of graphicsIn(tracks))
    if (item.options && item.options.set !== keep) sets.set(item.options.set, item.options);
  return [...sets.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The timeline with `tracks` and `designs` among its copies. Copies a graphic names stay; the rest fill what room
 * is left, newest last. When the named ones alone pass the limit, the oldest sets other than `keepSet` close until
 * they fit.
 */
export function withDesigns(
  timeline: Timeline,
  tracks: Tracks,
  designs: readonly GraphicComposition[],
  keepSet?: string,
): Timeline {
  const incoming = (copy: GraphicComposition) =>
    designs.some(
      (design) => design.id === copy.id && (design.hash === copy.hash || design.version === copy.version),
    );
  const others = (timeline.graphicCompositions ?? []).filter((copy) => !incoming(copy));
  const room = MAX_TIMELINE_COMPOSITIONS - designs.length;
  let kept = tracks;
  let named = namedDesigns(kept);
  const closing = oldestSets(kept, keepSet);
  while (others.filter((copy) => isNamed(copy, named)).length > room && closing.length > 0) {
    kept = withoutSets(kept, new Set([closing.shift()!.set]));
    named = namedDesigns(kept);
  }
  const used = others.filter((copy) => isNamed(copy, named));
  const unused = others.filter((copy) => !isNamed(copy, named));
  const spare = Math.max(0, room - used.length);
  return {
    ...timeline,
    tracks: kept,
    graphicCompositions: [...used, ...(spare > 0 ? unused.slice(-spare) : []), ...designs],
  };
}
