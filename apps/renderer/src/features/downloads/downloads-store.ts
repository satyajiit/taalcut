// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The download of everything this Mac needs, as the window follows it (UX2-DOWNLOADER): one read of
 * `system.downloads`, then each `components.downloads` event the jobs process sends (at once on a change of state,
 * at most four times a second while bytes arrive). No polling. One subscription per backend, shared by every view
 * that shows the download (the window bar's indicator, Settings › Models, first run, a clip waiting for its
 * models) and open while any of them is. A read that fails is tried again, waiting longer each time, and says
 * why meanwhile; an event that arrives while a read is out is newer than the read's answer, so it wins.
 */
import { callRpc, type Downloads, type TaalcutError } from '@taalcut/core';
import { useSyncExternalStore } from 'react';
import { useBackend } from '../../backend/backend';
import type { Backend } from '../../backend/contract';

export interface DownloadsView {
  /** The last state that arrived; null before the first. */
  readonly downloads: Downloads | null;
  /** The last read failed (the state, if any, is from before). Cleared by the next state that arrives. */
  readonly error: TaalcutError | null;
}

const RETRY_MAX_MS = 8000;

/** How long to wait after `failures` tries in a row failed: 1 s, 2 s, 4 s, then 8 s. */
export function retryDelay(failures: number): number {
  return Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.max(0, failures - 1));
}

class DownloadsFeed {
  private view: DownloadsView = { downloads: null, error: null };
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | undefined;
  private readTimer: ReturnType<typeof setTimeout> | undefined;
  private listenTimer: ReturnType<typeof setTimeout> | undefined;
  private readFailures = 0;
  private listenFailures = 0;
  /** Events received so far: a read's answer older than the latest event is dropped. */
  private events = 0;

  constructor(private readonly backend: Backend) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.open();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  };

  readonly snapshot = (): DownloadsView => this.view;

  /** Reads the state again now: after a command, or Try again on a failed read. */
  readonly refresh = (): void => {
    const signal = this.controller?.signal;
    if (signal) void this.read(signal);
  };

  private set(view: DownloadsView): void {
    this.view = view;
    for (const listener of this.listeners) listener();
  }

  private open(): void {
    const controller = new AbortController();
    this.controller = controller;
    void this.listen(controller.signal);
    void this.read(controller.signal);
  }

  private close(): void {
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.readTimer);
    clearTimeout(this.listenTimer);
  }

  private async listen(signal: AbortSignal): Promise<void> {
    const stream = await callRpc(
      this.backend.events.subscribe({ types: ['components.downloads'] }, { signal }),
    );
    if (signal.aborted) return;
    if (stream.ok) {
      try {
        for await (const event of stream.value) {
          if (event.type !== 'components.downloads') continue;
          this.events += 1;
          this.listenFailures = 0;
          this.set({ downloads: event.payload, error: null });
        }
      } catch (cause) {
        if (signal.aborted) return;
        console.warn(`[downloads] the download's events stopped: ${String(cause)}`);
      }
    }
    if (signal.aborted) return;
    // The stream ended while a view still shows the download (main restarted the jobs process): listen again, and
    // read what changed meanwhile.
    this.listenFailures += 1;
    this.listenTimer = setTimeout(() => {
      void this.listen(signal);
      void this.read(signal);
    }, retryDelay(this.listenFailures));
  }

  private async read(signal: AbortSignal): Promise<void> {
    clearTimeout(this.readTimer);
    const seen = this.events;
    const result = await callRpc(this.backend.system.downloads(undefined, { signal }));
    if (signal.aborted) return;
    if (result.ok) {
      this.readFailures = 0;
      if (this.events === seen) this.set({ downloads: result.value, error: null });
      return;
    }
    this.readFailures += 1;
    this.set({ downloads: this.view.downloads, error: result.error });
    this.readTimer = setTimeout(() => void this.read(signal), retryDelay(this.readFailures));
  }
}

const feeds = new WeakMap<Backend, DownloadsFeed>();

function feedOf(backend: Backend): DownloadsFeed {
  let feed = feeds.get(backend);
  if (!feed) {
    feed = new DownloadsFeed(backend);
    feeds.set(backend, feed);
  }
  return feed;
}

/** The download as it is now, and a way to read it again. */
export function useDownloads(): DownloadsView & { refresh(): void } {
  const feed = feedOf(useBackend());
  const view = useSyncExternalStore(feed.subscribe, feed.snapshot, feed.snapshot);
  return { ...view, refresh: feed.refresh };
}
