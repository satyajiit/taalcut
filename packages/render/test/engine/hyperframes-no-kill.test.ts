// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2, the third-party side: the patched HyperFrames engine and Puppeteer (patches/, NOTICE) never SIGKILL a
 * child that may hold a VideoToolbox session. The producer's FFmpeg children get one SIGTERM and are waited for;
 * the probe's deadline stops waiting, not the trial encode; the browser gets one SIGTERM (IX3-F9). Each child is
 * a Node stand-in that ignores SIGTERM and logs it, never FFmpeg or Chrome; only the test kills it, at the end.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProducerEngine } from '../../src/engine/producer';
import type {
  BrowserManagerModule,
  BrowsersModule,
  EngineModule,
  PuppeteerModule,
  StandInBrowser,
} from './hyperframes-modules';

// The engine and @puppeteer/browsers as the producer resolves them (render depends on neither directly): pnpm puts
// a package's dependencies next to it, and these packages export ESM only, so the folders are followed by hand.
const sibling = (packageDir: string, name: string) =>
  realpathSync(join(packageDir, '..', ...name.split('/')));
const producerDir = realpathSync(
  join(import.meta.dirname, '..', '..', 'node_modules', '@hyperframes', 'producer'),
);
const engineDir = sibling(producerDir, 'engine');
const engineEntry = join(engineDir, 'dist', 'index.js');
const puppeteerCoreDir = realpathSync(join(engineDir, '..', '..', 'puppeteer-core'));
const browsersEntry = join(sibling(puppeteerCoreDir, '@puppeteer/browsers'), 'lib', 'main.js');

const load = <T>(path: string) => import(pathToFileURL(path).href) as Promise<T>;
/** How long the patched engine waits for a GPU encoder's trial encode (patches/@hyperframes__engine). */
const GPU_PROBE_DEADLINE_MS = 30_000;

let dir: string;
let log: string;
let standIn: string;
const started: number[] = [];
// One stand-in file for the suite, run once before any test. The first run of a newly written executable costs
// about half a second on this Mac (0.43 s quiet, 0.5 s during a pnpm check; later runs of the same file 8 to 40 ms).
// A stand-in written per test paid it inside every test's 5 s startedPid wait, which a busy Mac once missed
// (LRN1-FIX).
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'taalcut-no-kill-'));
  log = join(dir, 'stand-in.log');
  standIn = join(dir, 'stand-in');
  // Answers `-encoders` like an FFmpeg with VideoToolbox; any other run logs its pid, ignores SIGTERM and stays.
  writeFileSync(
    standIn,
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      `const log = ${JSON.stringify(log)};`,
      "if (process.argv.includes('-encoders')) {",
      "  console.log(' V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)');",
      '  process.exit(0);',
      '}',
      "process.on('SIGTERM', () => fs.appendFileSync(log, 'sigterm\\n'));",
      'fs.appendFileSync(log, `start ${process.pid}\\n`);',
      'setInterval(() => undefined, 1000);',
      '',
    ].join('\n'),
  );
  chmodSync(standIn, 0o755);
  // `-encoders` answers and exits, so this first run logs nothing.
  await new Promise<void>((resolve, reject) => {
    const first = spawn(standIn, ['-encoders'], { stdio: 'ignore' });
    first.once('error', reject);
    first.once('exit', () => resolve());
  });
});
// Each test reads its own stand-ins' lines.
beforeEach(() => rmSync(log, { force: true }));
afterEach(() => {
  vi.useRealTimers();
  // The stand-ins only: Node scripts that hold nothing.
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Signal 0 checks the pid without touching it: it throws once the process is gone. */
const signalZero = (pid: number) => () => process.kill(pid, 0);

const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sigterms = () => lines().filter((line) => line === 'sigterm').length;
const browserManagerPath = () => join(engineDir, 'dist', 'services', 'browserManager.js');

/**
 * A stand-in Chrome launched through the patched @puppeteer/browsers, behind a close that never answers (to a
 * wedged Chrome); a dropped socket sends it to `Process.close`, as puppeteer-core's `closeBrowser` catch does.
 */
async function wedgedBrowser() {
  const browsers = await load<BrowsersModule>(browsersEntry);
  const launched = browsers.launch({
    executablePath: standIn,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  const pid = await startedPid();
  let drop: () => void = () => undefined;
  let closing = false;
  const browser: StandInBrowser = {
    process: () => launched.nodeProcess,
    version: () => Promise.resolve('stand-in'),
    close: () => {
      closing = true;
      return new Promise<void>((_, reject) => (drop = () => reject(new Error('socket closed')))).catch(() =>
        launched.close(),
      );
    },
    disconnect: () => {
      drop();
      return Promise.resolve();
    },
  };
  return { browser, pid, drop: () => drop(), closing: () => closing };
}

/** The engine's browser pool handing out `browser`, as a capture session gets it. */
async function pooled(manager: BrowserManagerModule, browser: StandInBrowser) {
  manager._resetBrowserPoolForTests();
  manager._setPuppeteerForTests({ launch: () => Promise.resolve(browser) });
  return manager.acquireBrowser([], { enableBrowserPool: false });
}

/** The stand-in's pid, polled on Node's own clock: faked timers leave it alone, where vi.waitFor would move them. */
async function startedPid(): Promise<number> {
  for (let waited = 0; waited < 5000; waited += 20) {
    const found = lines().find((entry) => entry.startsWith('start '));
    if (found) {
      started.push(Number(found.slice('start '.length)));
      return Number(found.slice('start '.length));
    }
    await delay(20);
  }
  throw new Error('the stand-in has not started');
}

describe('the patched HyperFrames engine and Puppeteer never SIGKILL (IX3-K2)', { timeout: 20_000 }, () => {
  it('stops an FFmpeg child with one SIGTERM and waits for it past the grace', async () => {
    const engine = await load<EngineModule>(engineEntry);
    const controller = new AbortController();
    const child = spawn(standIn, ['-i', 'x'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const managed = new engine.ManagedChildProcess(child, {
      signal: controller.signal,
      terminationGraceMs: 50,
    });
    const pid = await startedPid();
    controller.abort();
    await sleep(600);
    expect(lines().filter((line) => line === 'sigterm')).toHaveLength(1);
    expect(signalZero(pid)).not.toThrow();
    expect(managed.isSettled).toBe(false);
    process.kill(pid, 'SIGKILL');
    expect(await managed.wait()).toMatchObject({ reason: 'abort', signal: 'SIGKILL' });
  });

  it('answers "no GPU encoder" at the probe deadline and leaves the trial encode running, unsignalled', async () => {
    const engine = await load<EngineModule>(engineEntry);
    const before = process.env[engine.FFMPEG_PATH_ENV];
    process.env[engine.FFMPEG_PATH_ENV] = standIn;
    // Every process the engine starts, told synchronously at its spawn and at its exit (IX3-F7).
    const told: string[] = [];
    const stop = engine.onChildProcess((pid, event) => told.push(`${event} ${pid}`));
    try {
      // The deadline is the engine's timer: faked, so the trial encode's 30 s pass at once. Within them the
      // engine still waits (a busy machine's probe takes seconds; past 2 s it once meant no GPU encoder, UX2).
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let verdict: string | null | undefined;
      const detecting = engine.detectGpuEncoder().then((found) => (verdict = found));
      const pid = await startedPid();
      await vi.advanceTimersByTimeAsync(GPU_PROBE_DEADLINE_MS - 1_000);
      expect(verdict).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await detecting).toBeNull();
      vi.useRealTimers();
      await sleep(300);
      expect(signalZero(pid)).not.toThrow();
      expect(lines()).not.toContain('sigterm');
      // The probe's exit, for the producer's lease (IX3-F5, H3): pending while it runs, from the producer's engine.
      const exited = engine.gpuProbesExited();
      expect(exited).not.toBeNull();
      expect((await loadProducerEngine()).gpuProbesExited).toBe(engine.gpuProbesExited);
      let done = false;
      void exited?.then(() => (done = true));
      await sleep(100);
      expect(done).toBe(false);
      // `-encoders` came and went; the probe was told at its spawn and has not exited.
      expect(told.filter((line) => line.startsWith('spawn '))).toHaveLength(2);
      expect(told).toContain(`spawn ${pid}`);
      expect(told).not.toContain(`exit ${pid}`);
      process.kill(pid, 'SIGKILL');
      await exited;
      expect(engine.gpuProbesExited()).toBeNull();
      await vi.waitFor(() => expect(told).toContain(`exit ${pid}`), { timeout: 2000, interval: 10 });
    } finally {
      stop();
      if (before === undefined) delete process.env[engine.FFMPEG_PATH_ENV];
      else process.env[engine.FFMPEG_PATH_ENV] = before;
    }
  });

  it('tells of a launched browser by pid, to a listener that comes later too, and of its exit (IX3-F7)', async () => {
    const engine = await load<EngineModule>(engineEntry);
    const tracker = await load<{ trackBrowserProcess(proc: ChildProcess): void }>(
      join(engineDir, 'dist', 'utils', 'processTracker.js'),
    );
    const browser = spawn(standIn, [], { stdio: 'ignore' });
    const pid = await startedPid();
    tracker.trackBrowserProcess(browser);
    // Followed once, however often it is named (the spawn hook and the launch both name it, IX3-F8).
    tracker.trackBrowserProcess(browser);
    const told: string[] = [];
    const stop = engine.onChildProcess((child, event) => told.push(`${event} ${child}`));
    expect(told).toEqual([`spawn ${pid}`]);
    process.kill(pid, 'SIGKILL');
    await vi.waitFor(() => expect(told).toEqual([`spawn ${pid}`, `exit ${pid}`]), {
      timeout: 2000,
      interval: 10,
    });
    stop();
  });

  it("reads the spawn hook from the @puppeteer/browsers that the engine's Puppeteer imports (IX3-F8)", async () => {
    const engine = await load<EngineModule>(engineEntry);
    expect(realpathSync(engine.puppeteerBrowsersEntry())).toBe(realpathSync(browsersEntry));
    const browsers = await load<{ onBrowserSpawn?: unknown }>(browsersEntry);
    expect(typeof browsers.onBrowserSpawn).toBe('function');
  });

  it("tells of a browser at its spawn, while Puppeteer's launch still waits for DevTools (IX3-F8)", async () => {
    const engine = await load<EngineModule>(engineEntry);
    await engine.watchBrowserSpawns();
    const told: string[] = [];
    const stop = engine.onChildProcess((child, event) => told.push(`${event} ${child}`));
    // Puppeteer as the engine imports it; the stand-in never prints a DevTools endpoint, so the launch waits.
    const puppeteer = (await load<PuppeteerModule>(createRequire(engineEntry).resolve('puppeteer'))).default;
    let settled = false;
    const launching = puppeteer
      .launch({
        executablePath: standIn,
        headless: true,
        timeout: 60_000,
        args: [],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      })
      .then(
        () => 'launched',
        (error: unknown) => String(error),
      )
      .finally(() => (settled = true));
    const pid = await startedPid();
    expect(told).toEqual([`spawn ${pid}`]);
    expect(settled).toBe(false);
    // The test reaps its stand-in; the launch then fails, and the engine hears the exit.
    process.kill(pid, 'SIGKILL');
    expect(await launching).not.toBe('launched');
    await vi.waitFor(() => expect(told).toEqual([`spawn ${pid}`, `exit ${pid}`]), {
      timeout: 2000,
      interval: 10,
    });
    stop();
  });

  it('closes a wedged browser after a failed probe with one SIGTERM, never SIGKILL', async () => {
    const manager = await load<BrowserManagerModule>(
      join(engineDir, 'dist', 'services', 'browserManager.js'),
    );
    const child = spawn(standIn, [], { stdio: 'ignore' });
    const pid = await startedPid();
    const wedged = {
      close: () => new Promise<void>(() => undefined),
      process: () => child,
      disconnect: () => Promise.resolve(),
    };
    await manager._closeBrowserAfterFailedProbeForTests(wedged, 50);
    await sleep(400);
    expect(lines().filter((line) => line === 'sigterm')).toHaveLength(1);
    expect(signalZero(pid)).not.toThrow();
  });

  it('Puppeteer stops the browser with one SIGTERM, however often it is asked', async () => {
    const browsers = await load<BrowsersModule>(browsersEntry);
    const browser = browsers.launch({
      executablePath: standIn,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    const pid = await startedPid();
    const closing = browser.close();
    browser.kill();
    await sleep(400);
    expect(lines().filter((line) => line === 'sigterm')).toHaveLength(1);
    expect(signalZero(pid)).not.toThrow();
    process.kill(pid, 'SIGKILL');
    await closing;
  });
});

describe(
  'a close past its deadline sends the one SIGTERM, whoever sends it first (IX3-F9)',
  { timeout: 20_000 },
  () => {
    let manager: BrowserManagerModule;
    beforeEach(async () => {
      manager = await load<BrowserManagerModule>(browserManagerPath());
    });
    afterEach(() => {
      manager._setPuppeteerForTests(undefined);
      manager._resetBrowserPoolForTests();
    });

    it("the capture close's deadline first (stopBrowserProcess), then the abandoned close's Process.kill", async () => {
      const wedged = await wedgedBrowser();
      const lease = await pooled(manager, wedged.browser);
      void lease.release();
      await vi.waitFor(() => expect(wedged.closing()).toBe(true), { timeout: 2000, interval: 10 });
      // The 5 s deadline: the pool's force close stops the process, then disconnects, which drops the close.
      lease.forceRelease();
      await sleep(400);
      expect(sigterms()).toBe(1);
      expect(signalZero(wedged.pid)).not.toThrow();
    });

    it("the abandoned close's Process.kill first, then the capture close's deadline", async () => {
      const wedged = await wedgedBrowser();
      const lease = await pooled(manager, wedged.browser);
      void lease.release();
      await vi.waitFor(() => expect(wedged.closing()).toBe(true), { timeout: 2000, interval: 10 });
      wedged.drop();
      await vi.waitFor(() => expect(sigterms()).toBe(1), { timeout: 2000, interval: 10 });
      lease.forceRelease();
      await sleep(400);
      expect(sigterms()).toBe(1);
      expect(signalZero(wedged.pid)).not.toThrow();
    });

    it("the probe cleanup's deadline (250 ms in the engine), then the abandoned close's Process.kill", async () => {
      const wedged = await wedgedBrowser();
      await manager._closeBrowserAfterFailedProbeForTests(wedged.browser, 50);
      expect(wedged.closing()).toBe(true);
      await sleep(400);
      expect(sigterms()).toBe(1);
      expect(signalZero(wedged.pid)).not.toThrow();
    });
  },
);
