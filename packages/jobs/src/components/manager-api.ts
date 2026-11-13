// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The component manager's public shape (manager.ts builds it). */
import type { AsyncResult } from '@taalcut/core';
import type { StatfsLike } from './disk';
import type { DownloadOptions } from './download';
import type { StateLog } from './json-state';
import type { ComponentManifest } from './manifest';
import type { ProgressListener } from './progress';
import type { ComponentStatus, InstalledComponent } from './status';
import type { TermsBook } from './terms';

export interface ComponentManagerOptions {
  /** The components folder. Created if missing. */
  readonly root: string;
  readonly manifest: ComponentManifest;
  readonly fetch: DownloadOptions['fetch'];
  /** Default: fs.statfs. */
  readonly statfs?: StatfsLike;
  /** Default: this process, e.g. 'darwin-arm64'. */
  readonly platform?: string;
  /** Space to leave free after an install. Default 512 MiB. */
  readonly headroomBytes?: number;
  /** Retry policy, timeouts, sleep and jitter for downloads. */
  readonly download?: Omit<DownloadOptions, 'fetch' | 'signal' | 'onBytes'>;
  /** Minimum time between progress events within a phase. Default 250 ms. */
  readonly progressIntervalMs?: number;
  readonly now?: () => number;
  /** Where a state file that can't be read or written is reported. Default console.warn. */
  readonly log?: StateLog;
  /**
   * Where the person's acceptance of a component owner's terms is read (LNX1-TRM, terms.ts). An install of a
   * component whose terms aren't accepted, or of one that needs it, is refused (jobs.terms_not_accepted); absent,
   * every such install is.
   */
  readonly terms?: TermsBook;
}

export interface InstallPlan {
  /** Components that need downloading or updating, dependencies first. */
  readonly components: readonly {
    id: string;
    version: string;
    downloadBytes: number;
    extractBytes: number;
  }[];
  readonly downloadBytes: number;
  /** Download + extraction + headroom: what the disk check asks for. */
  readonly requiredBytes: number;
}

/** What a set of components still needs on disk, and what the disk has (undefined when statfs won't say). */
export interface SpaceCheck {
  readonly requiredBytes: number;
  readonly availableBytes: number | undefined;
}

export interface InstallOptions {
  readonly signal?: AbortSignal;
  /** Progress for each component installed, dependencies included (see `componentId`). */
  readonly onProgress?: ProgressListener;
}

export interface ComponentManager {
  list(): Promise<ComponentStatus[]>;
  get(id: string): Promise<InstalledComponent | undefined>;
  plan(ids: readonly string[]): AsyncResult<InstallPlan>;
  /**
   * Installs, or updates to the manifest version, with dependencies. Idempotent. A component whose files are current
   * but whose saved licence notice the manifest has replaced only fetches the new notice.
   */
  install(id: string, options?: InstallOptions): AsyncResult<InstalledComponent>;
  /**
   * Updates every installed component whose manifest version or sha256 changed, or whose licence notice did. Returns
   * their ids.
   */
  updateAll(options?: InstallOptions): AsyncResult<string[]>;
  /**
   * Brings the saved licence notice of every installed component up to the manifest's, without touching its files
   * (UX2-DOWNLOADER round 4): the new notice is fetched, verified and renamed over the old one, and a failure is that
   * component's last error, the old notice kept. It runs by itself once the registry loads and after an install that
   * worked; this starts it again and resolves once it has finished.
   */
  refreshNotices(): Promise<void>;
  /** Cancels a running install, then deletes the files, partial downloads and registry entry. */
  remove(id: string, options?: { force?: boolean }): AsyncResult<{ freedBytes: number }>;
  /** Deletes staging debris, unreferenced folders and partial downloads of versions no longer in the manifest. */
  cleanup(): Promise<void>;
  /**
   * Whether the disk has room for what `ids` (with their dependencies) still need: their downloads, less what is
   * on disk already, unpacked, plus the headroom. `jobs.downloads_space_low` when it hasn't.
   */
  checkSpace(ids: readonly string[]): AsyncResult<SpaceCheck>;
  /** Deletes a component's partial and verified downloads (a cancelled download). Not while it installs. */
  discardDownloads(id: string): Promise<void>;
  /**
   * Resolves once an install of `id` that was told to stop has let go of its files (a caller's cancel resolves
   * at once; the work winds down after). An install another caller still waits on keeps going.
   */
  settled(id: string): Promise<void>;
  /**
   * The process is going away: aborts every running install and resolves once each has let go of its files and
   * every state write asked so far (the registry, the last failures) is on disk. Nothing writes after it resolves:
   * an install, update or remove asked later says core.cancelled, and a cleanup or discard does nothing. Reads
   * still answer.
   */
  close(): Promise<void>;
}
