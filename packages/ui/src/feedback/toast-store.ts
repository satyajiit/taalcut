// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  /** Translated text: what happened. */
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** One button, e.g. "Undo". */
  action?: { label: string; onSelect: () => void };
  /** Milliseconds before it closes on its own. Default 5000; warnings and errors 8000. */
  duration?: number;
}

export interface ToastEntry extends ToastOptions {
  id: number;
  open: boolean;
}

/**
 * The toast queue: plain state with subscribers, so `toast()` works from
 * anywhere (event handlers, the chat client) and <Toaster> renders it.
 */
export interface ToastStore {
  show(options: ToastOptions): number;
  dismiss(id: number): void;
  /** Removes closed toasts after their exit animation. */
  remove(id: number): void;
  list(): readonly ToastEntry[];
  subscribe(listener: () => void): () => void;
}

export function createToastStore(): ToastStore {
  let entries: readonly ToastEntry[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const set = (value: readonly ToastEntry[]) => {
    entries = value;
    listeners.forEach((listener) => listener());
  };
  return {
    show(options) {
      const id = next++;
      set([...entries, { ...options, id, open: true }]);
      return id;
    },
    dismiss(id) {
      set(entries.map((entry) => (entry.id === id ? { ...entry, open: false } : entry)));
    },
    remove(id) {
      set(entries.filter((entry) => entry.id !== id));
    },
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app's toast queue. */
export const toastStore: ToastStore = createToastStore();

/** Shows a toast and returns its id. */
export function toast(options: ToastOptions): number {
  return toastStore.show(options);
}

export function dismissToast(id: number): void {
  toastStore.dismiss(id);
}
