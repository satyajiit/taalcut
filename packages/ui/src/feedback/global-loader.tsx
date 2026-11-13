// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { useSyncExternalStore } from 'react';
import { cn } from '#lib/cn';

/**
 * Counts work in flight anywhere in the app, for the global loader. Wrap a
 * promise with `track()`; the loader shows while any tracked promise is pending.
 */
export interface LoadingTracker {
  track<T>(work: Promise<T>): Promise<T>;
  /** Number of tracked promises still pending. */
  pending(): number;
  subscribe(listener: () => void): () => void;
}

export function createLoadingTracker(): LoadingTracker {
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    track(work) {
      count += 1;
      emit();
      const done = () => {
        count -= 1;
        emit();
      };
      work.then(done, done);
      return work;
    },
    pending: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app's tracker. Tests and stories can make their own. */
export const loadingTracker: LoadingTracker = createLoadingTracker();

/** True while the tracker has work pending. */
export function useTrackedLoading(tracker: LoadingTracker = loadingTracker): boolean {
  return useSyncExternalStore(tracker.subscribe, () => tracker.pending() > 0);
}

export interface GlobalLoaderProps {
  /** Show the bar. It fades in after a short delay, so quick work never flashes it. */
  active: boolean;
  className?: string;
}

/**
 * A thin marigold bar along the top of the window while anything loads
 * (PRD R32). Indeterminate: work that knows its progress uses a progress card.
 */
export function GlobalLoader({ active, className }: GlobalLoaderProps) {
  const { t } = useLingui();
  if (!active) return null;
  return (
    <div
      data-slot="global-loader"
      role="progressbar"
      aria-label={t`Loading`}
      aria-busy
      className={cn('tc-global-loader pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5', className)}
    >
      <span className="tc-global-loader-bar block h-full w-1/3 rounded-pill bg-primary" />
    </div>
  );
}
