// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the update dialog is open, outside React's tree: About's "See what's new", the sidebar's "Update ready"
 * item and the next launch after a Later all open the one dialog the root mounts (UpdateHost).
 */
import { useSyncExternalStore } from 'react';

let open = false;
/** What had focus when the dialog opened: focus goes back there when it closes. */
let returnFocus: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function openUpdateDialog(): void {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  set(true);
}

/** The element to focus after closing, if it is still on the page; read once. */
export function takeReturnFocus(): HTMLElement | null {
  const target = returnFocus;
  returnFocus = null;
  return target?.isConnected ? target : null;
}

export function closeUpdateDialog(): void {
  set(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateDialogOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
