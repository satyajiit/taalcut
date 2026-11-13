// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame timing inside a page or the preview's frame (P3-R1): requestAnimationFrame intervals, and every video
 * frame each <video> presents (requestVideoFrameCallback), including videos the composition adds later. The
 * probe functions run in the page (Playwright serialises them); `previewStats` turns what they saw into the
 * numbers tools/evals reads (`{ medianFps, p5Fps, droppedFrames }`) plus the raw counts.
 */

export interface ProbeReport {
  readonly rafDeltas: readonly number[];
  /** performance.now() of each presented video frame, every video together. */
  readonly presented: readonly number[];
  readonly videos: number;
  /** Chromium's own count over every video (getVideoPlaybackQuality). */
  readonly droppedVideoFrames: number;
  readonly totalVideoFrames: number;
  readonly startedAt: number;
  readonly stoppedAt: number;
}

interface ProbeState {
  stop: boolean;
  raf: number[];
  presented: number[];
  seen: Set<HTMLVideoElement>;
  startedAt: number;
}

/** Starts the probe in the page it runs in. */
export function startProbe(): void {
  const state: ProbeState = {
    stop: false,
    raf: [],
    presented: [],
    seen: new Set(),
    startedAt: performance.now(),
  };
  Object.assign(globalThis, { __taalcutPerf: state });
  let last = performance.now();
  const tick = (now: number) => {
    state.raf.push(now - last);
    last = now;
    if (!state.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const watch = (video: HTMLVideoElement) => {
    if (state.seen.has(video)) return;
    state.seen.add(video);
    const onFrame = (now: number) => {
      state.presented.push(now);
      if (!state.stop) video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  };
  const scan = () => {
    for (const video of document.querySelectorAll('video')) watch(video);
    if (!state.stop) setTimeout(scan, 100);
  };
  scan();
}

/** Stops the probe and returns what it saw. */
export function stopProbe(): ProbeReport {
  const state = (globalThis as { __taalcutPerf?: ProbeState }).__taalcutPerf;
  if (!state) throw new Error('no probe running');
  state.stop = true;
  let dropped = 0;
  let total = 0;
  for (const video of state.seen) {
    const quality = video.getVideoPlaybackQuality();
    dropped += quality.droppedVideoFrames;
    total += quality.totalVideoFrames;
  }
  return {
    rafDeltas: state.raf.slice(1),
    presented: [...state.presented].sort((a, b) => a - b),
    videos: state.seen.size,
    droppedVideoFrames: dropped,
    totalVideoFrames: total,
    startedAt: state.startedAt,
    stoppedAt: performance.now(),
  };
}

const quantile = (sorted: readonly number[], q: number) =>
  sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);

export interface PreviewStats {
  /** For tools/evals' preview schema. */
  readonly medianFps: number;
  readonly p5Fps: number;
  /** Frames the timeline should have shown and no video presented: rate × seconds − presented (floor 0). */
  readonly droppedFrames: number;
  readonly presentedFrames: number;
  readonly expectedFrames: number;
  readonly seconds: number;
  readonly fpsPerSecond: readonly number[];
  readonly chromiumDroppedVideoFrames: number;
  readonly videos: number;
  readonly raf: {
    readonly median: number;
    readonly p95: number;
    readonly worst: number;
    readonly over20: number;
  };
}

/**
 * Presented frames per one-second window of the playing span (from the first presented frame for `seconds`),
 * near-simultaneous presentations of two videos (a cut, both on screen) counted once.
 */
export function previewStats(report: ProbeReport, seconds: number, rate: number): PreviewStats {
  const frames: number[] = [];
  for (const at of report.presented)
    if (frames.length === 0 || at - (frames.at(-1) ?? 0) > 2) frames.push(at);
  const start = frames[0] ?? report.startedAt;
  const whole = Math.max(1, Math.floor(seconds));
  const perSecond = Array.from(
    { length: whole },
    (_, i) => frames.filter((at) => at >= start + i * 1000 && at < start + (i + 1) * 1000).length,
  );
  const sorted = [...perSecond].sort((a, b) => a - b);
  const presented = frames.filter((at) => at < start + seconds * 1000).length;
  const expected = Math.round(seconds * rate);
  const raf = [...report.rafDeltas].sort((a, b) => a - b);
  return {
    medianFps: quantile(sorted, 0.5),
    p5Fps: quantile(sorted, 0.05),
    droppedFrames: Math.max(0, expected - presented),
    presentedFrames: presented,
    expectedFrames: expected,
    seconds,
    fpsPerSecond: perSecond,
    chromiumDroppedVideoFrames: report.droppedVideoFrames,
    videos: report.videos,
    raf: {
      median: Math.round(quantile(raf, 0.5) * 10) / 10,
      p95: Math.round(quantile(raf, 0.95) * 10) / 10,
      worst: Math.round((raf.at(-1) ?? 0) * 10) / 10,
      over20: raf.filter((delta) => delta > 20).length,
    },
  };
}
