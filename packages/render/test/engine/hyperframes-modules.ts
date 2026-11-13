// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What hyperframes-no-kill.test.ts uses of the patched HyperFrames engine, its browser manager, Puppeteer and
 * @puppeteer/browsers, which it loads by path (ESM only, not render's own dependencies).
 */
import type { ChildProcess } from 'node:child_process';

export interface ManagedOutcome {
  readonly reason: string;
  readonly signal: string | null;
}
export interface EngineModule {
  ManagedChildProcess: new (
    child: ChildProcess,
    options: { signal?: AbortSignal; terminationGraceMs?: number },
  ) => { wait(): Promise<ManagedOutcome>; readonly isSettled: boolean };
  detectGpuEncoder(): Promise<string | null>;
  gpuProbesExited(): Promise<void> | null;
  onChildProcess(listener: (pid: number, event: 'spawn' | 'exit') => void): () => void;
  watchBrowserSpawns(): Promise<void>;
  puppeteerBrowsersEntry(): string;
  FFMPEG_PATH_ENV: string;
}
export interface PuppeteerModule {
  default: {
    launch(options: {
      executablePath: string;
      headless: boolean;
      timeout: number;
      args: string[];
      handleSIGINT: boolean;
      handleSIGTERM: boolean;
      handleSIGHUP: boolean;
    }): Promise<unknown>;
  };
}
export interface StandInBrowser {
  close(): Promise<void>;
  process(): ChildProcess;
  disconnect(): Promise<void>;
  version?(): Promise<string>;
}
export interface BrowserManagerModule {
  _closeBrowserAfterFailedProbeForTests(browser: StandInBrowser, timeoutMs: number): Promise<void>;
  _setPuppeteerForTests(mock: { launch(): Promise<StandInBrowser> } | undefined): void;
  _resetBrowserPoolForTests(): void;
  acquireBrowser(
    args: string[],
    config: { enableBrowserPool: boolean },
  ): Promise<{ release(): Promise<void>; forceRelease(): void }>;
}
export interface BrowsersModule {
  launch(options: {
    executablePath: string;
    args?: string[];
    handleSIGINT?: boolean;
    handleSIGTERM?: boolean;
    handleSIGHUP?: boolean;
  }): { readonly nodeProcess: ChildProcess; close(): Promise<void>; kill(): void };
}
