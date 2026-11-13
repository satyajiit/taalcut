// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small "everything this Mac needs" for the download set's tests, served by the local test server: a runtime two
 * models depend on, a model of its own, a big one, and an on-demand tool no tier lists. Each file is real bytes with
 * a real sha256; the manager under test is the real one, wrapped only to see when each install starts and ends.
 */
import { ok } from '@taalcut/core';
import {
  createComponentManager,
  createDownloadSet,
  type ComponentManager,
  type ComponentManifest,
  type DownloadSetOptions,
  type DownloadSetStatus,
  type TermsBook,
} from '@taalcut/jobs';
import type { DownloadOptions } from '../../src/components/download';
import { DeterministicContent } from './content';
import { manifestOf, noSleep, PLATFORM, plentyOfSpace, type FileComponentSpec } from './fixtures';
import type { TestServer } from './server';

export const KiB = 1024;
export const MiB = 1024 * KiB;

export const SET_FILES = {
  runtime: new DeterministicContent(256 * KiB, 'set-runtime'),
  speech: new DeterministicContent(1 * MiB, 'set-speech'),
  search: new DeterministicContent(2 * MiB, 'set-search'),
  shots: new DeterministicContent(512 * KiB, 'set-shots'),
  writing: new DeterministicContent(4 * MiB, 'set-writing'),
  tool: new DeterministicContent(64 * KiB, 'set-tool'),
} as const;
export type SetFile = keyof typeof SET_FILES;

const TIER = ['recommended'];
const DEPENDS: Partial<Record<SetFile, readonly SetFile[]>> = { speech: ['runtime'], search: ['runtime'] };

export function serveSet(server: TestServer): void {
  for (const [id, content] of Object.entries(SET_FILES))
    server.serve(`/${id}`, { content, etag: `"${id}-1"` });
}

/** The set's manifest; `wrong` components claim a sha256 their file doesn't have. */
export function setManifest(server: TestServer, wrong: readonly SetFile[] = []): ComponentManifest {
  const specs: FileComponentSpec[] = Object.entries(SET_FILES).map(([id, content]) => ({
    id,
    urls: [server.url(`/${id}`)],
    size: content.size,
    sha256: wrong.includes(id as SetFile) ? '0'.repeat(64) : content.sha256(),
    dependencies: DEPENDS[id as SetFile] ?? [],
    tiers: id === 'tool' ? [] : TIER,
  }));
  return manifestOf(...specs);
}

export interface Recorded {
  readonly manager: ComponentManager;
  /** `start:<id>` and `end:<id>`, in order. */
  readonly events: string[];
  /** The most installs that ran at once. */
  readonly peak: () => number;
}

/**
 * The real manager, wrapped to see when each install starts and ends; `afterInstall` runs once the install has
 * resolved and before its caller hears, standing in for the bookkeeping an install does after the registry lists it.
 */
export function recording(
  manager: ComponentManager,
  afterInstall: (id: string) => Promise<void> = async () => undefined,
): Recorded {
  const events: string[] = [];
  let running = 0;
  let peak = 0;
  return {
    events,
    peak: () => peak,
    manager: {
      list: () => manager.list(),
      get: (id) => manager.get(id),
      plan: (ids) => manager.plan(ids),
      updateAll: (options) => manager.updateAll(options),
      refreshNotices: () => manager.refreshNotices(),
      remove: (id, options) => manager.remove(id, options),
      cleanup: () => manager.cleanup(),
      checkSpace: (ids) => manager.checkSpace(ids),
      discardDownloads: (id) => manager.discardDownloads(id),
      settled: (id) => manager.settled(id),
      close: () => manager.close(),
      async install(id, options) {
        events.push(`start:${id}`);
        peak = Math.max(peak, ++running);
        const result = await manager.install(id, options);
        await afterInstall(id);
        running -= 1;
        events.push(`end:${id}`);
        return result;
      },
    },
  };
}

export interface SetHarness extends Recorded {
  readonly set: ReturnType<typeof createDownloadSet>;
  readonly changes: string[];
  /** What the app does at quit: the set stops, then the manager; nothing writes under `root` after. */
  close(): Promise<void>;
}

export function makeSet(
  root: string,
  manifest: ComponentManifest,
  options: {
    readonly lanes?: number;
    readonly download?: Omit<DownloadOptions, 'fetch' | 'signal' | 'onBytes' | 'onRetry'>;
    readonly statfs?: Parameters<typeof createComponentManager>[0]['statfs'];
    readonly machine?: DownloadSetOptions['machine'];
    readonly afterInstall?: (id: string) => Promise<void>;
    /** Default PLATFORM (darwin-arm64). */
    readonly platform?: string;
    readonly log?: (message: string) => void;
    /** Where acceptances of an owner's terms are read (LNX1-TRM), for the manager and the set. */
    readonly terms?: TermsBook;
  } = {},
): SetHarness {
  const recorded = recording(
    createComponentManager({
      root,
      manifest,
      fetch: globalThis.fetch,
      statfs: options.statfs ?? plentyOfSpace,
      platform: options.platform ?? PLATFORM,
      download: options.download ?? { sleep: noSleep, retry: { maxAttempts: 2, initialDelayMs: 0 } },
      progressIntervalMs: 0,
      ...(options.terms ? { terms: options.terms } : {}),
    }),
    options.afterInstall,
  );
  const changes: string[] = [];
  const set = createDownloadSet({
    manager: recorded.manager,
    manifest,
    root,
    machine: options.machine ?? (async () => ok({ tier: 'recommended' })),
    platform: options.platform ?? PLATFORM,
    ...(options.log ? { log: options.log } : {}),
    ...(options.terms ? { terms: options.terms } : {}),
    lanes: options.lanes ?? 2,
    onChange: (kind) => changes.push(kind),
  });
  const close = async () => {
    await set.stop();
    await recorded.manager.close();
  };
  return { ...recorded, set, changes, close };
}

/** Polls the set until `check` passes (a run moves on by itself). */
export async function until(
  set: SetHarness['set'],
  check: (status: DownloadSetStatus) => boolean,
  timeoutMs = 10_000,
): Promise<DownloadSetStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await set.status();
    if (check(status)) return status;
    if (Date.now() > deadline) throw new Error(`timed out; last state ${JSON.stringify(summary(status))}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** id → state, for readable assertions. */
export function summary(status: DownloadSetStatus): Record<string, string> {
  return Object.fromEntries(status.entries.map((entry) => [entry.status.id, entry.state]));
}
