// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether Send feedback is open, and what opened it, outside React's tree:
 * ⌘K, Help → Send feedback (the `help.feedback` UI command) and an error
 * line's "Report this" all open the one dialog the root mounts.
 */
import type { TaalcutError } from '@taalcut/core';
import { useSyncExternalStore } from 'react';

export interface FeedbackState {
  readonly open: boolean;
  /** "Report this": the error the person was looking at, named in the dialog and the bundle. */
  readonly error: TaalcutError | null;
  /** Counts openings, so a dialog opened again starts clean. */
  readonly opened: number;
}

let state: FeedbackState = { open: false, error: null, opened: 0 };
const listeners = new Set<() => void>();

function set(next: FeedbackState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function openFeedback(error: TaalcutError | null = null): void {
  set({ open: true, error, opened: state.opened + 1 });
}

export function closeFeedback(): void {
  if (state.open) set({ ...state, open: false });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFeedbackState(): FeedbackState {
  return useSyncExternalStore(subscribe, () => state);
}
