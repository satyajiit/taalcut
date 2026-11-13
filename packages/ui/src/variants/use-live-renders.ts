// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RenderId, RenderSnapshot } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useCardData } from '../cards/card-data';

/**
 * Several renders kept current (CardData.watchRender), one subscription each: a render's id maps to its snapshot,
 * null once it is gone, and is missing until it first arrives (or when the app can't watch renders).
 */
export function useLiveRenders(
  ids: readonly (RenderId | null)[],
): ReadonlyMap<RenderId, RenderSnapshot | null> {
  const data = useCardData();
  const [renders, setRenders] = useState<ReadonlyMap<RenderId, RenderSnapshot | null>>(new Map());
  const key = ids.filter(Boolean).join(' ');
  useEffect(() => {
    setRenders(new Map());
    const watch = data.watchRender;
    if (!watch || key === '') return;
    const stops = key
      .split(' ')
      .map((id) =>
        watch(id as RenderId, (render) => setRenders((was) => new Map(was).set(id as RenderId, render))),
      );
    return () => {
      for (const stop of stops) stop();
    };
  }, [data, key]);
  return renders;
}
