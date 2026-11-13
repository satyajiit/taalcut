// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Auto-update skeleton (P1-B4): electron-updater against a private generic
 * feed. Not user-facing yet: it reports progress as UpdateEvents (logged by
 * start.ts; the event bus will carry them to the UI later) and installs a
 * staged update when the app next quits.
 *
 * On macOS there are three steps, and the events keep them apart:
 *   'downloaded'  electron-updater fetched the zip and checked its sha512
 *                 against latest-mac.yml (which is unsigned, so it proves
 *                 only that the zip is the one the feed listed)
 *   'verified'    the bundle inside is strictly newer than the running app
 *                 and signed by its team (candidate.ts); otherwise 'rejected'
 *                 with a typed error, and Squirrel never sees it
 *   'staged'      Squirrel.Mac accepted the new bundle's code signature
 *                 (it must satisfy the running app's designated requirement)
 *                 and will install it on quit
 * So electron-updater's autoInstallOnAppQuit is off: it would hand the zip
 * to Squirrel straight after downloading, from a cache file any process of
 * the user can rewrite. After 'verified' this module points Squirrel at a
 * loopback feed (squirrel-feed.ts) that serves the verified snapshot, and
 * removes both once Squirrel has staged the update or failed.
 * Electron is injected (both updaters, the feed and timers) so this is
 * unit-tested.
 */
import { err, toTaalcutError, type Result } from '@taalcut/core';
import {
  openGate,
  requireSignedOffer,
  type ManifestGate,
  type OfferInfo as SignedOfferInfo,
} from './manifest-gate';
import type { Snapshot } from './snapshot';
import type { SquirrelFeed } from './squirrel-feed';
import type { UpdateEvent } from './update-event';
import type { VerifiedUpdate } from './verify-download';
import { refuseBlockedVersions } from './blocked';

export type { UpdateEvent } from './update-event';

/** The part of electron-updater's AppUpdater used here. */
export interface AppUpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: {
    info(message?: unknown): void;
    warn(message?: unknown): void;
    error(message?: unknown): void;
  } | null;
  /**
   * Assigning this sets `allowDowngrade` on electron-updater 6.8.9.
   * startUpdates sets `allowDowngrade` back to false immediately after.
   */
  channel: string | null;
  allowDowngrade: boolean;
  /** Asked before an update is offered (blocked.ts and manifest-gate.ts wrap it). electron-updater passes its UpdateInfo. */
  isUpdateSupported(info: SignedOfferInfo): boolean | Promise<boolean>;
  setFeedURL(options: { provider: 'generic'; url: string; channel?: string }): void;
  checkForUpdates(): Promise<unknown>;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

/** Electron's native autoUpdater (Squirrel.Mac). */
export interface NativeUpdaterPort {
  on(event: 'update-downloaded', listener: () => void): unknown;
  on(event: 'error', listener: () => void): unknown;
  setFeedURL(options: { url: string }): void;
  /** Fetch the update from the feed and stage it. */
  checkForUpdates(): void;
  /** Quit and install a staged update. The updates router calls this only when status is ready. */
  quitAndInstall(): void;
}

export interface UpdateSchedule {
  /** Delay before the first check. */
  readonly initialDelayMs: number;
  /** Time between checks. */
  readonly intervalMs: number;
}

export const DEFAULT_SCHEDULE: UpdateSchedule = { initialDelayMs: 10_000, intervalMs: 6 * 60 * 60 * 1000 };

export interface Updates {
  checkNow(): Promise<void>;
  /** Points electron-updater at another channel's feed (the person switched channel) and checks at once. */
  repoint(feedUrl: string, channel: string | undefined): Promise<void>;
  /** Quits and installs whatever Squirrel has staged. Callers gate this on status ready. */
  installNow(): void;
  stop(): void;
}

export interface StartUpdatesOptions {
  readonly updater: AppUpdaterPort;
  readonly native: NativeUpdaterPort;
  /** Checks the downloaded zip (verify-download.ts). */
  readonly verifyDownload: (downloadedZip: string) => Promise<Result<VerifiedUpdate>>;
  /** Serves a verified snapshot to Squirrel (squirrel-feed.ts). */
  readonly serveToSquirrel: (snapshot: Snapshot) => Promise<SquirrelFeed>;
  readonly feedUrl: string;
  /**
   * Non-empty: generic provider channel, so the client requests `<channel>-mac.yml`.
   * Empty or omitted: Phase 1, `{ provider: 'generic', url }` and latest-mac.yml.
   */
  readonly channel?: string;
  readonly onEvent: (event: UpdateEvent) => void;
  /** Versions this Mac rolled back from: never offered (blocked.ts). */
  readonly blocked?: () => readonly string[];
  /**
   * The signed channel file (SB-19, manifest-gate.ts): verified before the update library is asked, and its offer
   * and download held to it. Absent only in unit tests of the rest of the pipeline; start.ts always passes one.
   */
  readonly manifest?: ManifestGate;
  readonly schedule?: UpdateSchedule;
  readonly timers?: {
    setTimeout(callback: () => void, ms: number): unknown;
    setInterval(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

export function startUpdates(options: StartUpdatesOptions): Updates {
  const { updater } = options;
  const gate = options.manifest ?? openGate();
  const onEvent = gate.reporting(options.onEvent);
  const verifyDownload = gate.holdDownload(options.verifyDownload);
  const schedule = options.schedule ?? DEFAULT_SCHEDULE;
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    setInterval: (callback: () => void, ms: number) => setInterval(callback, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  updater.autoDownload = true;
  // Squirrel gets the update only after verifyDownload accepts it (see above).
  updater.autoInstallOnAppQuit = false;
  // electron-updater's own logging is noise, except the two lines that say a download is a delta (blockmap).
  updater.logger = deltaLogger(onEvent);
  if (options.blocked) refuseBlockedVersions(updater, options.blocked);
  requireSignedOffer(updater, gate);
  let feedUrl = options.feedUrl;
  let channel = options.channel;
  pointFeed(updater, feedUrl, channel);

  const on = (event: string, listener: (...args: never[]) => void) => updater.on(event, listener);
  on('checking-for-update', () => onEvent({ type: 'checking', feedUrl }));
  on('update-available', (info: OfferInfo) => {
    onEvent({ type: 'available', version: info.version });
    const releaseNotes = notesText(info.releaseNotes);
    if (releaseNotes !== undefined || info.releaseDate) {
      onEvent({
        type: 'release-info',
        version: info.version,
        ...(releaseNotes !== undefined ? { releaseNotes } : {}),
        ...(info.releaseDate ? { releaseDate: info.releaseDate } : {}),
      });
    }
  });
  on('update-not-available', (info: { version: string }) =>
    onEvent({ type: 'not-available', version: info.version }),
  );
  on('download-progress', (progress: { percent: number }) =>
    onEvent({ type: 'progress', percent: Math.round(progress.percent) }),
  );
  on('update-downloaded', (info: { version: string; downloadedFile: string }) => {
    onEvent({ type: 'downloaded', version: info.version });
    void stageIfTrusted(info.downloadedFile);
  });
  on('error', (error: Error) => onEvent({ type: 'error', message: error?.message ?? String(error) }));
  // The feed and snapshot of the update Squirrel is fetching, until it staged it or failed.
  let staging: (() => void) | undefined;
  const doneStaging = () => {
    staging?.();
    staging = undefined;
  };
  options.native.on('update-downloaded', () => {
    doneStaging();
    onEvent({ type: 'staged' });
  });
  // electron-updater reports Squirrel's errors as its own 'error' event.
  options.native.on('error', doneStaging);

  async function stageIfTrusted(downloadedZip: string): Promise<void> {
    let verdict: Result<VerifiedUpdate>;
    try {
      verdict = await verifyDownload(downloadedZip);
    } catch (cause) {
      verdict = err(toTaalcutError(cause));
    }
    if (!verdict.ok) {
      onEvent({ type: 'rejected', error: verdict.error });
      return;
    }
    const { identity, snapshot } = verdict.value;
    let feed: SquirrelFeed;
    try {
      feed = await options.serveToSquirrel(snapshot);
    } catch (cause) {
      await snapshot.dispose().catch(() => undefined);
      onEvent({ type: 'rejected', error: toTaalcutError(cause) });
      return;
    }
    doneStaging();
    staging = () => {
      feed.close();
      void snapshot.dispose().catch(() => undefined);
    };
    onEvent({ type: 'verified', version: identity.version, team: identity.team ?? 'none' });
    options.native.setFeedURL({ url: feed.url });
    options.native.checkForUpdates();
  }

  const checkNow = () => gate.check(feedUrl, channel, () => updater.checkForUpdates());
  let interval: unknown;
  const first = timers.setTimeout(() => {
    void checkNow();
    interval = timers.setInterval(() => void checkNow(), schedule.intervalMs);
  }, schedule.initialDelayMs);

  return {
    checkNow,
    async repoint(nextUrl, nextChannel) {
      feedUrl = nextUrl;
      channel = nextChannel;
      pointFeed(updater, feedUrl, channel);
      await checkNow();
    },
    installNow() {
      options.native.quitAndInstall();
    },
    stop() {
      timers.clear(first);
      if (interval !== undefined) timers.clear(interval);
    },
  };
}

/** What electron-updater's update-available carries (UpdateInfo), as far as it is read here. */
interface OfferInfo {
  readonly version: string;
  readonly releaseNotes?:
    string | readonly { readonly version: string; readonly note: string | null }[] | null;
  readonly releaseDate?: string;
}

/** Notes as one text (fullChangelog gives one note per version). */
function notesText(notes: OfferInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return notes;
  if (!notes || notes.length === 0) return undefined;
  return notes.map((entry) => entry.note ?? '').join('\n\n');
}

/**
 * Setting `channel` on electron-updater 6.8 also sets allowDowngrade; put it back at once: candidate.ts still
 * refuses anything not strictly newer, and a channel switch must never offer an older build.
 * No channel: Phase 1, `{ provider: 'generic', url }` and latest-mac.yml (a public build's stable channel too).
 */
function pointFeed(updater: AppUpdaterPort, feedUrl: string, channel: string | undefined): void {
  const named = channel?.trim() || undefined;
  if (named) {
    updater.setFeedURL({ provider: 'generic', url: feedUrl, channel: named });
    updater.channel = named;
  } else {
    updater.setFeedURL({ provider: 'generic', url: feedUrl });
    // The updater's channel wins over the provider's, and once set it can't go back to null: name the default.
    if (updater.channel !== null) updater.channel = 'latest';
  }
  updater.allowDowngrade = false;
}

/**
 * electron-updater has no event for a differential (blockmap) download; its log says so. These two lines are
 * from AppUpdater.differentialDownloadInstaller in 6.8 (update-channels.test.ts; the delta e2e notices a change).
 */
export function deltaLogger(onEvent: (event: UpdateEvent) => void): NonNullable<AppUpdaterPort['logger']> {
  return {
    info(message) {
      if (typeof message === 'string' && message.startsWith('Download block maps'))
        onEvent({ type: 'delta' });
    },
    warn: () => {},
    error(message) {
      if (typeof message === 'string' && message.startsWith('Cannot download differentially'))
        onEvent({ type: 'delta-failed' });
    },
  };
}
