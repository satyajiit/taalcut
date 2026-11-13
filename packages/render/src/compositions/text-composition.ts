// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { GraphicComposition, GraphicItem, TextItem } from '@taalcut/core';

/** Replace the text in its own track and time; adding a second item would draw both titles. */
export function textComposition(
  item: TextItem,
  composition: GraphicComposition,
  wordsVariable: string,
  params: Readonly<Record<string, string | number | boolean>> = {},
): GraphicItem {
  return {
    type: 'graphic',
    id: item.id,
    start: item.start,
    duration: item.duration,
    anchor: { kind: 'time', at: item.start },
    placement: { box: { x: 0, y: 0, width: 1, height: 1 } },
    styleKey: 'composition',
    language: item.language,
    origin: item.origin === 'user' ? 'user' : 'agent',
    ...(item.overlayId ? { overlay: { id: item.overlayId, words: item.origin } } : {}),
    composition: {
      id: composition.id,
      hash: composition.hash,
      params: { [wordsVariable]: item.text, ...params },
    },
  };
}
