// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CoverSettings, Timeline } from '@taalcut/core';
import { useEffect, useState } from 'react';

type Aspect = CoverSettings['aspect'];
type Draft = { value: CoverSettings; base: CoverSettings | undefined; conflict: boolean };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Each aspect keeps its draft when the person switches formats or another window saves a cover. */
export function useCoverDrafts(
  timeline: Timeline,
  fallback: CoverSettings,
  make: (aspect: Aspect) => CoverSettings,
) {
  const first = timeline.covers?.at(-1);
  const [aspect, setAspect] = useState<Aspect>((first ?? fallback).aspect);
  const [drafts, setDrafts] = useState<Partial<Record<Aspect, Draft>>>(() => ({
    [aspect]: { value: first ?? fallback, base: first, conflict: false },
  }));
  const draft = drafts[aspect]!;
  const saved = timeline.covers?.find((cover) => cover.aspect === aspect);
  useEffect(() => {
    setDrafts((old) => {
      let changed = false;
      const next = { ...old };
      for (const [key, entry] of Object.entries(old) as [Aspect, Draft][]) {
        const current = timeline.covers?.find((cover) => cover.aspect === key);
        if (same(current, entry.base)) continue;
        const clean = same(entry.value, entry.base) || same(entry.value, current);
        if (clean) {
          next[key] = { value: current ?? make(key), base: current, conflict: false };
          changed = true;
        } else if (!entry.conflict) {
          next[key] = { ...entry, conflict: true };
          changed = true;
        }
      }
      return changed ? next : old;
    });
  }, [timeline.covers]);
  return {
    cover: draft.value,
    saved,
    conflict: draft.conflict,
    dirty: !same(draft.value, saved),
    patch(changes: Partial<CoverSettings>) {
      setDrafts((old) => ({
        ...old,
        [aspect]: { ...old[aspect]!, value: { ...old[aspect]!.value, ...changes } },
      }));
    },
    select(next: Aspect) {
      if (next === aspect) return;
      setDrafts((old) => {
        if (old[next]) return old;
        const kept = timeline.covers?.find((cover) => cover.aspect === next);
        return { ...old, [next]: { value: kept ?? make(next), base: kept, conflict: false } };
      });
      setAspect(next);
    },
    discard() {
      setDrafts((old) => ({
        ...old,
        [aspect]: { value: saved ?? make(aspect), base: saved, conflict: false },
      }));
    },
  };
}
