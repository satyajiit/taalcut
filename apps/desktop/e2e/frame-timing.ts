// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame timing around one click, measured in the page: the intervals between
 * requestAnimationFrame timestamps from the last frame before the click to
 * `windowMs` after it, and the first frame in which `probe` has moved. A frame
 * the main thread misses shows as a long interval; a fold that waits before
 * moving shows as a late first moving frame.
 */
import type { Page } from '@playwright/test';
import { sumFields } from '@taalcut/core';

export interface ClickFrames {
  /** ms between consecutive frames, starting with the one the click lands in. */
  readonly intervals: number[];
  /** 1 for the first frame after the click; null if the probe never moved. */
  readonly firstMoveFrame: number | null;
  /** From the click to the start of the first frame in which the probe had moved. */
  readonly clickToMoveMs: number | null;
  /**
   * From the click to the start of the first frame after it (0 when that frame began before the click ran). The
   * first of `intervals` starts at the last frame before the click, so it also holds the wait before the click.
   */
  readonly clickToFirstFrameMs: number;
  /** The median interval of ten frames before the click (the display's refresh). */
  readonly refreshMs: number;
}

/**
 * Clicks `target` between two frames and records the frames that follow.
 * `probe` is an element the click moves (its left edge is read after each
 * frame is rendered); null when nothing in the page is expected to move (a
 * view transition draws over it).
 */
export function clickFrames(
  page: Page,
  target: string,
  probe: string | null,
  windowMs = 400,
): Promise<ClickFrames> {
  return page.evaluate(
    async ({ target, probe, windowMs }) => {
      const button = document.querySelector<HTMLElement>(target);
      const moving = probe === null ? null : document.querySelector(probe);
      if (!button || (probe !== null && !moving)) throw new Error(`missing ${button ? probe : target}`);
      const left = () => moving?.getBoundingClientRect().left ?? 0;
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const idle: number[] = [];
      let last = await frame();
      for (let i = 0; i < 10; i += 1) {
        const now = await frame();
        idle.push(now - last);
        last = now;
      }
      const before = left();
      // Between two frames, like a real click.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const clickedAt = performance.now();
      button.click();
      const frames: { t: number; x: number }[] = [];
      await new Promise<void>((resolve) => {
        // Read the probe after each frame has been rendered: a message posted from rAF runs after paint.
        const channel = new MessageChannel();
        let stamp = 0;
        channel.port1.onmessage = () => frames.push({ t: stamp, x: left() });
        const tick = (t: number) => {
          stamp = t;
          channel.port2.postMessage(null);
          if (t - clickedAt < windowMs) requestAnimationFrame(tick);
          else setTimeout(resolve, 30);
        };
        requestAnimationFrame(tick);
      });
      const intervals = frames.map((f, i) => f.t - (i === 0 ? last : (frames[i - 1]?.t ?? last)));
      const moved = frames.findIndex((f) => Math.abs(f.x - before) > 0.5);
      const sorted = [...idle].sort((a, b) => a - b);
      return {
        intervals,
        firstMoveFrame: moved === -1 ? null : moved + 1,
        clickToMoveMs: moved === -1 ? null : (frames[moved]?.t ?? clickedAt) - clickedAt,
        clickToFirstFrameMs: Math.max(0, (frames[0]?.t ?? clickedAt) - clickedAt),
        refreshMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      };
    },
    { target, probe, windowMs },
  );
}

export interface FrameStats {
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  /** Frames longer than 12 ms (at 120 Hz, a missed frame). */
  readonly over12: number;
  /** Frames longer than 16.7 ms (a missed frame even at 60 Hz). */
  readonly over16: number;
  /** Worst first moving frame (1 = the next frame) and the median click-to-movement time. */
  readonly worstFirstMove: number | null;
  readonly medianClickToMoveMs: number | null;
}

/** How the compositor presented the frames that animated (Chromium's frame reporter). */
export interface PresentedFrames {
  /** Frames with an animation running (main-thread or compositor). */
  readonly animated: number;
  /** Shown whole, on time. */
  readonly presentedAll: number;
  /** Shown on time without the main thread's update (a main-thread animation stood still that frame). */
  readonly partial: number;
  readonly dropped: number;
  /** Of those, dropped while a compositor animation ran (a visible hitch, not the wait before the first frame). */
  readonly droppedMoving: number;
  /** Of the animated frames, how many had a main-thread animation (JavaScript or a non-composited CSS one). */
  readonly mainThread: number;
}

const PRESENTED_KEYS: readonly (keyof PresentedFrames)[] = [
  'animated',
  'presentedAll',
  'partial',
  'dropped',
  'droppedMoving',
  'mainThread',
];

interface TraceEvent {
  readonly name?: string;
  readonly ph?: string;
  readonly pid?: number;
  readonly args?: {
    readonly frame_reporter?: {
      readonly state?: string;
      readonly has_main_animation?: boolean;
      readonly has_compositor_animation?: boolean;
    };
  };
}

/** Counts the animated frames in a Chromium trace (devtools.timeline.frame), in the busiest renderer. */
export function presentedFrames(traceJson: string): PresentedFrames {
  const parsed = JSON.parse(traceJson) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const frames = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b' && e.args?.frame_reporter);
  const perProcess = new Map<number, number>();
  for (const f of frames) perProcess.set(f.pid ?? 0, (perProcess.get(f.pid ?? 0) ?? 0) + 1);
  const renderer = [...perProcess.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const animated = frames
    .filter((f) => f.pid === renderer)
    .flatMap((f) => (f.args?.frame_reporter ? [f.args.frame_reporter] : []))
    .filter((r) => r.has_main_animation || r.has_compositor_animation);
  const count = (state: string) => animated.filter((r) => r.state === state).length;
  return {
    animated: animated.length,
    presentedAll: count('STATE_PRESENTED_ALL'),
    partial: count('STATE_PRESENTED_PARTIAL'),
    dropped: count('STATE_DROPPED'),
    droppedMoving: animated.filter((r) => r.state === 'STATE_DROPPED' && r.has_compositor_animation).length,
    mainThread: animated.filter((r) => r.has_main_animation).length,
  };
}

/** Adds up several traces' counts. */
export function addPresented(all: readonly PresentedFrames[]): PresentedFrames {
  return sumFields(all, PRESENTED_KEYS);
}

const quantile = (sorted: readonly number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;

export function frameStats(samples: readonly ClickFrames[]): FrameStats {
  const all = samples.flatMap((s) => s.intervals).sort((a, b) => a - b);
  const firsts = samples.map((s) => s.firstMoveFrame);
  const delays = samples
    .map((s) => s.clickToMoveMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: all.length,
    p50: round(quantile(all, 0.5)),
    p95: round(quantile(all, 0.95)),
    max: round(all.at(-1) ?? 0),
    over12: all.filter((i) => i > 12).length,
    over16: all.filter((i) => i > 16.7).length,
    worstFirstMove: firsts.includes(null) ? null : Math.max(...(firsts as number[])),
    medianClickToMoveMs: delays.length ? round(quantile(delays, 0.5)) : null,
  };
}
