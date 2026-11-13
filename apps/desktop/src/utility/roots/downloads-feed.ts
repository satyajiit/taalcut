// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `components.downloads` event from the jobs process (UX2-DOWNLOADER): at once when the download changes
 * state (a component starts or ends, a pause, a failure), and while bytes arrive at most every `intervalMs`, a
 * trailing one catching up. One read at a time, so events go out in the order things happened.
 */
import { createSerialQueue, type Downloads } from '@taalcut/core';

export interface DownloadsFeedOptions {
  readonly read: () => Promise<Downloads>;
  readonly emit: (downloads: Downloads) => void;
  /** Between two progress events. Default 250 ms: the bar moves four times a second. */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

export interface DownloadsFeed {
  changed(kind: 'progress' | 'state'): void;
  /**
   * The process is going away (or a test ends): drops a pending trailing event, and nothing is sent after, so
   * the download stopping at quit doesn't announce itself on a bus that is closing.
   */
  stop(): void;
}

export function createDownloadsFeed(options: DownloadsFeedOptions): DownloadsFeed {
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((message: string) => console.warn(message));
  let lastAt = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  /** One read at a time; the read and the emit catch and log their own failures. */
  const reads = createSerialQueue();
  let stopped = false;

  const send = () => {
    lastAt = now();
    void reads.run(async () => {
      try {
        options.emit(await options.read());
      } catch (cause) {
        log(
          `[components] downloads event not sent: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    });
  };

  return {
    changed(kind) {
      if (stopped) return;
      if (kind === 'state') {
        clearTimeout(trailing);
        trailing = undefined;
        send();
        return;
      }
      if (trailing) return;
      const wait = lastAt + intervalMs - now();
      if (wait <= 0) send();
      else
        trailing = setTimeout(() => {
          trailing = undefined;
          send();
        }, wait);
    },
    stop() {
      stopped = true;
      clearTimeout(trailing);
      trailing = undefined;
    },
  };
}
