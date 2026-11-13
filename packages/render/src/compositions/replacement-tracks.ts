// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { compositionFor, type GraphicComposition, type GraphicItem, type Timeline } from '@taalcut/core';
import { textComposition } from './text-composition';

type Params = Readonly<Record<string, string | number | boolean>>;
const defaultOf = (variable: GraphicComposition['variables'][number]) =>
  variable.type === 'text' ? variable.sample : variable.default;

function revisedGraphic(
  item: GraphicItem,
  timeline: Timeline,
  composition: GraphicComposition,
  overrides: Params | undefined,
): GraphicItem {
  const previous =
    compositionFor(item.composition, timeline.graphicCompositions) ??
    (timeline.graphicCompositions ?? [])
      .filter((copy) => copy.id === item.composition.id)
      .sort((a, b) => b.version - a.version)[0];
  const merged: Record<string, string | number | boolean> = { ...item.composition.params, ...overrides };
  // Keep each graphic's values; intentional changes to the design's defaults update matching variables.
  for (const variable of composition.variables) {
    if (overrides?.[variable.name] !== undefined) continue;
    const nextDefault = defaultOf(variable);
    if (nextDefault === '' || nextDefault === undefined) continue;
    const prevVariable = previous?.variables.find((entry) => entry.name === variable.name);
    const prevDefault = prevVariable ? defaultOf(prevVariable) : undefined;
    if (
      (prevDefault !== undefined && prevDefault !== nextDefault) ||
      (previous === undefined && overrides === undefined && item.composition.hash !== composition.hash)
    ) {
      merged[variable.name] = nextDefault;
    }
  }
  const names = new Set(composition.variables.map((variable) => variable.name));
  const params = Object.fromEntries(Object.entries(merged).filter(([name]) => names.has(name)));
  return { ...item, composition: { id: composition.id, hash: composition.hash, params } };
}

/** Replace only the chosen visual items; native text becomes the graphic in its original track slot. */
export function replacementTracks(
  timeline: Timeline,
  itemIds: readonly string[],
  composition: GraphicComposition,
  wordsVariable: string,
  params?: Params,
): Timeline['tracks'] {
  return timeline.tracks.map((track) =>
    track.kind !== 'text'
      ? track
      : {
          ...track,
          items: track.items.map((item) => {
            if (!itemIds.includes(item.id)) return item;
            return item.type === 'text'
              ? textComposition(item, composition, wordsVariable, params)
              : revisedGraphic(item, timeline, composition, params);
          }),
        },
  );
}
