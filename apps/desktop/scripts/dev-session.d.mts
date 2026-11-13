// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Types for dev-session.mjs, which dev.mjs runs as plain JavaScript and test/dev-session.test.ts imports. */

/** What the session needs of a started app: Node's ChildProcess, or a test's stand-in. */
export interface DevApp {
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  kill(): unknown;
}

export interface DevSessionTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface DevSessionOptions {
  /** Every file the app loads is in out/. */
  readonly ready: () => boolean;
  /** Starts Electron. */
  readonly launch: () => DevApp;
  /** Ends dev.mjs. */
  readonly exit: (code: number) => void;
  readonly log?: (message: string) => void;
  readonly configs?: readonly string[];
  readonly settleMs?: number;
  readonly timers?: DevSessionTimers;
}

export interface DevSession {
  started(name: string): void;
  built(name: string): void;
  stop(code: number): void;
  readonly state: {
    readonly building: string[];
    readonly built: string[];
    readonly running: boolean;
    readonly replacing: boolean;
  };
}

export const DEV_CONFIGS: readonly string[];
export const DEV_OUTPUTS: readonly string[];
export const IGNORED_BY_WATCH: RegExp;
export const SETTLE_MS: number;
export const STOP_GRACE_MS: number;

export interface DevTrackedConfig {
  name?: string;
  outDir: string;
  plugins: unknown;
}

export function rebuildTracker(session: Pick<DevSession, 'started'>): {
  readonly name: string;
  tsdownConfigResolved(config: DevTrackedConfig): void;
};

export function createDevSession(options: DevSessionOptions): DevSession;
