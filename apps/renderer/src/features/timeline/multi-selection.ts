// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TimelineItemId } from '@taalcut/core';
import { useState } from 'react';

/** Stable ids survive document refreshes; deleted scenes disappear from the effective selection. */
export function useMultiSelection(ids: readonly TimelineItemId[]) {
  const [chosen, setChosen] = useState<Set<TimelineItemId>>(new Set());
  const [anchor, setAnchor] = useState<TimelineItemId | null>(null);
  const selected = ids.filter((id) => chosen.has(id));
  const pick = (id: TimelineItemId, extend = false, toggle = false) => {
    if (extend && anchor && ids.includes(anchor)) {
      const a = ids.indexOf(anchor),
        b = ids.indexOf(id);
      setChosen(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)));
    } else if (toggle) {
      setChosen((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(id);
    } else {
      setChosen(new Set([id]));
      setAnchor(id);
    }
  };
  return { selected, pick, clear: () => setChosen(new Set()) };
}
