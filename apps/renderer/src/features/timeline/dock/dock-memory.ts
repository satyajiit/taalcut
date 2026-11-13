// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which side panel each project's editor had open (EDT1): the editor opens with the dock on Chat, and after that
 * as you left it in that project (Chat, Versions, Comments or closed). In localStorage, a convenience: without it, Chat.
 * A project with no cut yet opens with the dock closed until you open it, and so does a narrow window (under
 * 1100 px, where the sidebar folds too): the viewer, the inspector and the dock wouldn't fit beside each other.
 * Clean up opens from its card or ⌘K only, so a project left on it opens on Chat.
 */
import type { ProjectId } from '@taalcut/core';
import type { DockPanel } from './editor-dock';

export const DOCK_STORAGE_KEY = 'taalcut.editorDock';
/** The most projects remembered; the ones opened longest ago go first. */
const KEEP = 50;

type Stored = Record<string, 'chat' | 'versions' | 'comments' | 'closed'>;

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Stored) : {};
  } catch {
    return {};
  }
}

/**
 * The panel this project's editor opens with: as it was left there, else Chat when `roomy` (the project has a video
 * to edit, in a window wide enough; a project with no cut yet shows its own starters).
 */
export function rememberedDock(projectId: ProjectId, roomy: boolean): DockPanel | null {
  const kept = read()[projectId];
  if (kept === 'closed') return null;
  if (kept === 'versions') return 'versions';
  if (kept === 'comments') return 'comments'; // EDT1-CMT
  return kept === 'chat' || roomy ? 'chat' : null;
}

export function rememberDock(projectId: ProjectId, panel: DockPanel | null): void {
  const value = panel === null ? 'closed' : panel === 'versions' || panel === 'comments' ? panel : 'chat';
  try {
    const { [projectId]: _old, ...rest } = read();
    const kept = Object.entries(rest).slice(-(KEEP - 1));
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify(Object.fromEntries([...kept, [projectId, value]])),
    );
  } catch {
    // A private window or full storage: the next open starts on Chat.
  }
}
