// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Picking projects for batch work (P3-V16, UX1): a selection mode, entered with Select or by ticking a row's box
 * (shown on hover and focus), left with Done or Escape, which also let go of what was picked.
 */
import type { ProjectId } from '@taalcut/core';
import { useCallback, useState } from 'react';

export interface ProjectSelection {
  /** Every row shows its box, and the bulk bar is there. */
  readonly selecting: boolean;
  readonly selected: ReadonlySet<ProjectId>;
  readonly start: () => void;
  /** Leaves selection mode and lets go of everything. */
  readonly stop: () => void;
  /** Ticks or unticks one project; ticking one starts selection mode. */
  readonly select: (projectId: ProjectId, on: boolean) => void;
  readonly setAll: (ids: readonly ProjectId[]) => void;
}

export function useProjectSelection(): ProjectSelection {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<ProjectId>>(new Set());
  const start = useCallback(() => setSelecting(true), []);
  const stop = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const select = useCallback((projectId: ProjectId, on: boolean) => {
    if (on) setSelecting(true);
    setSelected((now) => {
      const next = new Set(now);
      if (on) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  }, []);
  const setAll = useCallback((ids: readonly ProjectId[]) => setSelected(new Set(ids)), []);
  return { selecting, selected, start, stop, select, setAll };
}
