// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How long the app takes to start (P3-R1, v1.0 gate criterion 7: cold start under 3 s), without Playwright in
 * the way: the binary is spawned directly with --remote-debugging-port=0 (test builds accept it; unpackaged
 * runs refuse nothing), and the window's own clock says when things happened. Every time is milliseconds
 * after the spawn, on the same machine clock (`performance.timeOrigin` is epoch time):
 *
 * - `navigationMs`: the window started loading app://taalcut/ (main is up and made the window);
 * - `fcpMs`: first contentful paint (largest contentful paint isn't listed without an observer, so it isn't kept);
 * - `interactiveMs`: the window bar's Close button is enabled, i.e. the page is connected to main and has the
 *   window's state. Seen by polling every 15 ms once the page has loaded, so it is late by at most one poll;
 *   `interactiveFirstPoll` says when the very first look already saw it (then it is an upper bound).
 *
 * The packaged build starts through packaged-app.ts's startPackaged; the unpackaged one through
 * `startUnpackaged`, which gives the same RunningApp so devToolsPort reads either's port. The packaged test
 * build ships copy-renderer.mjs's placeholder page (scripts/package-e2e.mjs, `build:placeholder`), which has no
 * window bar: measured with `renderer: 'placeholder'`, it stops at the first paint and says interactive: null.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { connectToPage, type CdpPage } from './cdp';
import { devToolsPort, type RunningApp } from './packaged-app';

export interface StartTimes {
  readonly navigationMs: number;
  readonly fcpMs: number;
  /** Null on the placeholder renderer, which has no window bar. */
  readonly interactiveMs: number | null;
  readonly interactiveFirstPoll: boolean;
}

/** The page the build is expected to show: the app, or the placeholder (packaged test builds). */
export type ExpectedRenderer = 'app' | 'placeholder';

interface PageClock {
  readonly origin: number;
  readonly fcp: number | null;
  /** performance.now() when the Close button was enabled, or null. */
  readonly interactiveAt: number | null;
  /** copy-renderer.mjs's placeholder page: out/ was built (by anyone) while apps/renderer/dist was missing. */
  readonly placeholder: boolean;
}

const POLL_MS = 15;

/** Reads the page's clock and paint entries; runs in the page. */
function readClock(): PageClock {
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
  const close = document.querySelector<HTMLButtonElement>(
    '[data-slot=window-bar] button[aria-label="Close window"]',
  );
  return {
    origin: performance.timeOrigin,
    fcp,
    interactiveAt: close && !close.disabled ? performance.now() : null,
    placeholder: document.querySelector('script[src="/probe.mjs"]') !== null,
  };
}

/** What the page showed instead, for the error when it never became interactive; runs in the page. */
function describePage(): Record<string, unknown> {
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close window"]');
  return {
    url: location.href,
    windowBar: document.querySelector('[data-slot=window-bar]') !== null,
    close: close
      ? { disabled: close.disabled, inBar: close.closest('[data-slot=window-bar]') !== null }
      : null,
    text: document.body.innerText.slice(0, 300),
  };
}

async function pollInteractive(
  page: CdpPage,
  deadline: number,
  expected: ExpectedRenderer,
): Promise<{ clock: PageClock; polls: number }> {
  for (let polls = 1; ; polls += 1) {
    const clock = await page.evaluate(readClock, undefined);
    if (clock.placeholder !== (expected === 'placeholder') && clock.fcp !== null)
      throw new Error(`expected the ${expected} renderer, got the other: was the build made without it?`);
    if (clock.fcp !== null && (clock.interactiveAt !== null || expected === 'placeholder'))
      return { clock, polls };
    if (Date.now() > deadline) {
      const seen = await page.evaluate(describePage, undefined);
      throw new Error(`not interactive in time: ${JSON.stringify({ clock, seen })}`);
    }
    await delay(POLL_MS);
  }
}

/**
 * The test build in out/ (`electron <desktopDir>`) with its own userData and remote debugging, as a RunningApp.
 * Only stderr is kept: it carries the DevTools port.
 */
export function startUnpackaged(options: {
  readonly electron: string;
  readonly desktopDir: string;
  readonly userData: string;
  readonly env: NodeJS.ProcessEnv;
}): RunningApp {
  const child = spawn(
    options.electron,
    [options.desktopDir, `--user-data-dir=${options.userData}`, '--remote-debugging-port=0'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: options.env },
  );
  const errText: string[] = [];
  child.stderr?.setEncoding('utf8').on('data', (text: string) => errText.push(text));
  const exited = once(child, 'exit').then(([code, signal]: unknown[]) => String(code ?? signal ?? 'unknown'));
  const running = () => child.exitCode === null && child.signalCode === null;
  return {
    child,
    stdout: () => '',
    stderr: () => errText.join(''),
    exited,
    exitWithin: (ms) => Promise.race([exited, delay(ms, 'still running')]),
    async stop() {
      if (!running()) return;
      child.kill('SIGTERM');
      if ((await Promise.race([exited, delay(10_000, 'stuck')])) === 'stuck') child.kill('SIGKILL');
      await exited;
    },
  };
}

/** One launch, already started at `spawnedAt` (epoch ms): measures, then stops the app. */
export async function measureStart(
  app: RunningApp,
  spawnedAt: number,
  expected: ExpectedRenderer = 'app',
  timeoutMs = 60_000,
): Promise<StartTimes> {
  try {
    const port = await devToolsPort(app, timeoutMs);
    const page = await connectToPage(port, 'app://taalcut/', timeoutMs);
    try {
      const { clock, polls } = await pollInteractive(page, spawnedAt + timeoutMs, expected);
      const after = (pageTime: number) => Math.round(clock.origin + pageTime - spawnedAt);
      return {
        navigationMs: after(0),
        fcpMs: after(clock.fcp ?? 0),
        interactiveMs: clock.interactiveAt === null ? null : after(clock.interactiveAt),
        interactiveFirstPoll: polls === 1,
      };
    } finally {
      page.close();
    }
  } finally {
    await app.stop();
  }
}

/** Median and spread of a list of numbers (nulls left out), for the report; null when there are none. */
export function spread(
  values: readonly (number | null)[],
): { median: number; min: number; max: number } | null {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { median, min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 };
}
