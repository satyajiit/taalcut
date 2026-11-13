// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Progress events for one component install: phase, bytes, speed, ETA and an
 * overall fraction for the job card. Throttled, so a 64 KiB chunk stream does
 * not become thousands of IPC messages.
 */

export const COMPONENT_PHASES = ['checking', 'downloading', 'verifying', 'extracting', 'installing'] as const;
export type ComponentPhase = (typeof COMPONENT_PHASES)[number];

export interface ComponentProgress {
  readonly componentId: string;
  readonly version: string;
  readonly phase: ComponentPhase;
  /**
   * Bytes handled in this phase: hashed while checking a partial download or
   * verifying, received while downloading, read from the archive while extracting.
   */
  readonly bytesDone: number;
  readonly bytesTotal: number;
  /** Download speed over the last few seconds. 0 outside the downloading phase. */
  readonly bytesPerSecond: number;
  /** Seconds left in the download at the current speed, when there is a speed to go on. */
  readonly etaSeconds?: number;
  /** Overall progress of this component in [0, 1]. Drops back only when a changed remote file restarts from zero. */
  readonly fraction: number;
  /**
   * Set while the download waits to reconnect after a network error: the failures in a row and when the next try
   * starts (epoch ms). The next bytes clear it.
   */
  readonly retry?: { readonly attempt: number; readonly at: number };
}

export type ProgressListener = (progress: ComponentProgress) => void;

/** Share of the bar each phase gets. Checking a partial download climbs to its offset in the download share. */
const WEIGHTS = {
  file: { download: 0.97, verify: 0.02, extract: 0 },
  archive: { download: 0.8, verify: 0.02, extract: 0.17 },
} as const;

/**
 * Bytes per second over a sliding window, sampled at most every `sampleEveryMs`. No speed until the samples span
 * `minSpanMs`: a download's first second (TLS, TCP slow start, lanes starting one after another) runs far below
 * its speed, and an estimate from it said "141 kB/s, about 8 hr left" right after a relaunch (UX2 round 3's real
 * run) where the next seconds ran at 8 MB/s.
 */
export class SpeedMeter {
  private samples: { t: number; bytes: number }[] = [];

  constructor(
    private readonly windowMs = 5_000,
    private readonly sampleEveryMs = 100,
    private readonly minSpanMs = 3_000,
  ) {}

  add(t: number, bytesDone: number): void {
    const last = this.samples.at(-1);
    if (last && t - last.t < this.sampleEveryMs) return;
    this.samples.push({ t, bytes: bytesDone });
    // Keep one sample older than the window as the baseline.
    while (this.samples.length > 2 && this.samples[1]!.t <= t - this.windowMs) this.samples.shift();
  }

  bytesPerSecond(now: number, bytesDone: number): number {
    const first = this.samples[0];
    if (!first || now <= first.t || now - first.t < this.minSpanMs) return 0;
    return Math.max(0, ((bytesDone - first.bytes) * 1000) / (now - first.t));
  }

  reset(): void {
    this.samples = [];
  }
}

export interface ProgressReporterOptions {
  readonly componentId: string;
  readonly version: string;
  readonly installType: 'file' | 'archive';
  readonly onProgress?: ProgressListener;
  /** Minimum time between two events in the same phase. Phase changes and phase ends always go out. */
  readonly intervalMs?: number;
  readonly now?: () => number;
}

export class ProgressReporter {
  private lastPhase: ComponentPhase | undefined;
  private lastEmitAt = -Infinity;
  private last: { bytesDone: number; bytesTotal: number } = { bytesDone: 0, bytesTotal: 0 };
  /** A reconnect went out: the next update goes out too, whatever the throttle, so the flag clears at once. */
  private reconnected = false;
  private readonly meter = new SpeedMeter();
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly weights: (typeof WEIGHTS)[keyof typeof WEIGHTS];

  constructor(private readonly options: ProgressReporterOptions) {
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? 250;
    this.weights = WEIGHTS[options.installType];
  }

  update(phase: ComponentPhase, bytesDone: number, bytesTotal: number): void {
    const t = this.now();
    const phaseChanged = phase !== this.lastPhase;
    if (phaseChanged && phase === 'downloading') this.meter.reset();
    if (phase === 'downloading') this.meter.add(t, bytesDone);
    this.last = { bytesDone, bytesTotal };
    const phaseEnd = bytesTotal > 0 && bytesDone >= bytesTotal;
    const throttled =
      !phaseChanged && !phaseEnd && !this.reconnected && t - this.lastEmitAt < this.intervalMs;
    if (throttled) return;
    this.reconnected = false;
    this.lastPhase = phase;
    this.lastEmitAt = t;
    this.options.onProgress?.(this.build(phase, bytesDone, bytesTotal, t));
  }

  /** The download waits `delayMs` before its next try (attempt `attempt`): said at once, at the bytes so far. */
  reconnecting(attempt: number, delayMs: number): void {
    const t = this.now();
    this.meter.reset();
    this.reconnected = true;
    this.lastPhase = 'downloading';
    this.lastEmitAt = t;
    const { bytesDone, bytesTotal } = this.last;
    const { componentId, version, fraction } = this.build('downloading', bytesDone, bytesTotal, t);
    this.options.onProgress?.({
      componentId,
      version,
      phase: 'downloading',
      bytesDone,
      bytesTotal,
      bytesPerSecond: 0,
      fraction,
      retry: { attempt, at: t + delayMs },
    });
  }

  private build(phase: ComponentPhase, bytesDone: number, bytesTotal: number, t: number): ComponentProgress {
    const share = bytesTotal > 0 ? Math.min(1, bytesDone / bytesTotal) : 0;
    const { download, verify, extract } = this.weights;
    const install = 1 - download - verify - extract;
    const start = {
      checking: 0,
      downloading: 0,
      verifying: download,
      extracting: download + verify,
      installing: 1 - install,
    };
    const width = {
      checking: download,
      downloading: download,
      verifying: verify,
      extracting: extract,
      installing: install,
    };
    const fraction = Math.min(1, start[phase] + width[phase] * share);
    const base = {
      componentId: this.options.componentId,
      version: this.options.version,
      phase,
      bytesDone,
      bytesTotal,
      fraction,
    };
    if (phase !== 'downloading') return { ...base, bytesPerSecond: 0 };
    const bytesPerSecond = this.meter.bytesPerSecond(t, bytesDone);
    const remaining = Math.max(0, bytesTotal - bytesDone);
    if (bytesPerSecond <= 0)
      return { ...base, bytesPerSecond, ...(remaining === 0 ? { etaSeconds: 0 } : {}) };
    return { ...base, bytesPerSecond, etaSeconds: Math.ceil(remaining / bytesPerSecond) };
  }
}
