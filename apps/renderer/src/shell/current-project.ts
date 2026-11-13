// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The project the page on screen edits, if any (the timeline editor sets it).
 * ⌘Z and ⇧⌘Z, the menu's Undo and ⌘K's Undo then work in that project's
 * history; elsewhere they undo app-wide changes (settings). Outside React's
 * tree so the palette and the page share it.
 */
import type { ProjectId } from '@taalcut/core';
import { useEffect, useSyncExternalStore } from 'react';

let current: ProjectId | null = null;
const listeners = new Set<() => void>();

export function currentProject(): ProjectId | null {
  return current;
}

function set(next: ProjectId | null): void {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The project whose history undo and redo use now. */
export function useCurrentProject(): ProjectId | null {
  return useSyncExternalStore(subscribe, currentProject);
}

/** Called by a project's page: its history is the one undo uses while it is open. */
export function useProjectHistory(projectId: ProjectId | null): void {
  useEffect(() => {
    set(projectId);
    return () => set(null);
  }, [projectId]);
}
