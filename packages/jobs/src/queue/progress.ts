// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Progress from a handler, throttled: at most one event per interval, the
 * first report immediately and the latest one always delivered (trailing),
 * so the UI never shows a stale value and never floods the event bus.
 */

export interface ProgressReporter {
  /** `fraction` 0..1 (clamped), or null when unknown. `detail` is free-form, e.g. { done: 3, total: 10 }. */
  report(fraction: number | null, detail?: unknown): void;
}

export interface ProgressValue {
  readonly fraction: number | null;
  readonly detail?: unknown;
}

export class ThrottledProgress implements ProgressReporter {
  private latest: ProgressValue | undefined;
  private unsaved = false;
  private lastEmit = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly intervalMs: number,
    private readonly emit: (value: ProgressValue) => void,
  ) {}

  report(fraction: number | null, detail?: unknown): void {
    if (this.closed) return;
    const clamped = fraction === null || Number.isNaN(fraction) ? null : Math.min(1, Math.max(0, fraction));
    this.latest = detail === undefined ? { fraction: clamped } : { fraction: clamped, detail };
    this.unsaved = true;
    const wait = this.lastEmit + this.intervalMs - performance.now();
    if (wait <= 0) this.send();
    else this.timer ??= setTimeout(() => this.send(), wait);
  }

  /** The latest value not yet saved by a heartbeat, and marks it saved. */
  takeUnsaved(): ProgressValue | undefined {
    if (!this.unsaved) return undefined;
    this.unsaved = false;
    return this.latest;
  }

  /** Sends a pending value now and stops accepting reports. */
  close(): void {
    if (this.timer) this.send();
    this.closed = true;
  }

  private send(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.latest) return;
    this.lastEmit = performance.now();
    this.emit(this.latest);
  }
}
