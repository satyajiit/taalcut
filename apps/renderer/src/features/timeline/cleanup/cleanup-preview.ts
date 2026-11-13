// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cleanup plan the dock's panel is showing (P3-V9), for the bed to mark its removed spans: the panel is in
 * the dock, the bed in the editor, and this is all they share. One plan at a time; the panel clears it when it
 * closes or applies.
 */
import type { CleanupPlan, TimelineId } from '@taalcut/core';
import { useSyncExternalStore } from 'react';

let shown: CleanupPlan | null = null;
const listeners = new Set<() => void>();

export function showCleanupPreview(plan: CleanupPlan | null): void {
  if (plan === shown) return;
  shown = plan;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The plan shown for this timeline, or null. */
export function useCleanupPreview(timelineId: TimelineId | null): CleanupPlan | null {
  const plan = useSyncExternalStore(subscribe, () => shown);
  return plan && plan.timelineId === timelineId ? plan : null;
}
