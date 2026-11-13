// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What `manager.list()` says about each component: its state on disk, and what this manager is doing with it now
 * (the running install's latest progress) or did last (why the last install failed). The failure is kept in
 * `failures.json` beside the registry, so the reason is still on the row after a restart (UX2-DOWNLOADER); an
 * install of it that works clears it.
 */
import { join } from 'node:path';
import { taalcutErrorSchema, type TaalcutError } from '@taalcut/core';
import { z } from 'zod';
import type { JsonState } from './json-state';
import type { ComponentArtifact, ComponentEntry, ComponentLicence } from './manifest';
import type { ComponentProgress } from './progress';
import type { InstalledEntry } from './registry';

export interface InstalledComponent {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
  /** Absolute path of the component's folder. */
  readonly path: string;
  /** Absolute path of the file, for single-file components. */
  readonly file?: string;
  readonly bytes: number;
  readonly installedAt: string;
  readonly licence: ComponentLicence;
  /** Absolute path of its licence notice, saved in its folder at install (TAALCUT-NOTICE.txt). */
  readonly notice: string;
}

/**
 * - `installed`: this version, its files and its licence notice as the manifest has them.
 * - `notice_outdated`: this version and its files, but the manifest has since corrected its licence notice; the old
 *   one is still saved in its folder until the new one replaces it (an install of it fetches only the notice).
 * - `update_available`: another version or build is here. `not_installed`, `unsupported`: none, or none for here.
 */
export type ComponentState =
  'installed' | 'notice_outdated' | 'update_available' | 'not_installed' | 'unsupported';

export interface ComponentStatus {
  readonly id: string;
  readonly name: string;
  readonly kind: ComponentEntry['kind'];
  readonly version: string;
  readonly tiers: ComponentEntry['tiers'];
  /** What the machine must have for it to run (machineFit), as the manifest states it. */
  readonly requires?: ComponentEntry['requires'];
  readonly licence: ComponentLicence;
  readonly state: ComponentState;
  /** An install or update is running in this manager. */
  readonly installing: boolean;
  /** The running install's latest progress event (absent before its first one, and when nothing runs). */
  readonly progress?: ComponentProgress;
  /**
   * Why the last install of it failed: its own download, or a dependency's that stopped it. Kept across restarts
   * until an install of it works; a cancelled install leaves it alone.
   */
  readonly lastError?: TaalcutError;
  readonly installed?: InstalledComponent;
  /** Download size for this platform. */
  readonly downloadBytes?: number;
  /** Bytes of a partial download that the next install resumes from. */
  readonly partialBytes: number;
}

export const FailuresFileSchema = z.object({
  v: z.literal(1),
  failures: z.record(z.string(), taalcutErrorSchema),
});
export type FailuresFile = z.infer<typeof FailuresFileSchema>;

export const NO_FAILURES = (): FailuresFile => ({ v: 1, failures: {} });

/** Each component's last failed install, saved as it changes (`file`; none in tests that don't need it). */
export class FailureBook {
  private failures = new Map<string, TaalcutError>();

  constructor(private readonly file?: JsonState<FailuresFile>) {}

  /** Reads what an earlier run saved. Failures noted before this finishes win over the saved ones. */
  async load(): Promise<void> {
    if (!this.file) return;
    const saved = await this.file.read();
    this.failures = new Map([...Object.entries(saved.failures), ...this.failures]);
  }

  /** Records a failed install; a cancellation isn't a failure, so it changes nothing. */
  async note(id: string, error: TaalcutError): Promise<void> {
    if (error.code === 'core.cancelled') return;
    this.failures.set(id, error);
    await this.save();
  }

  /** Forgets it: an install of it worked, or it was removed. */
  async clear(id: string): Promise<void> {
    if (this.failures.delete(id)) await this.save();
    // Nothing to forget here, but a write another caller started may still be on its way: wait for it.
    else await this.file?.settled();
  }

  get(id: string): TaalcutError | undefined {
    return this.failures.get(id);
  }

  /** Resolves once every write asked so far has settled: nothing of it writes after. */
  async settled(): Promise<void> {
    await this.file?.settled();
  }

  private async save(): Promise<void> {
    await this.file?.write({ v: 1, failures: Object.fromEntries(this.failures) });
  }
}

/** A registry entry as callers see it: its folder and file as paths under the components folder. */
export function installedView(root: string, entry: InstalledEntry): InstalledComponent {
  const path = join(root, entry.dir);
  return {
    id: entry.id,
    version: entry.version,
    sha256: entry.sha256,
    path,
    ...(entry.file ? { file: join(path, entry.file) } : {}),
    bytes: entry.bytes,
    installedAt: entry.installedAt,
    licence: entry.licence,
    notice: join(path, entry.notice),
  };
}

/** One row of `list()`, from what the manager knows of the component. */
export function componentStatus(input: {
  readonly component: ComponentEntry;
  /** This platform's artifact; none means it doesn't run here. */
  readonly artifact: ComponentArtifact | undefined;
  /** What the registry has of it, when its files are still there. */
  readonly installed: InstalledComponent | undefined;
  /** Its install under way, if any. */
  readonly running: { readonly progress: ComponentProgress | undefined } | undefined;
  readonly lastError: TaalcutError | undefined;
  readonly partialBytes: number;
}): ComponentStatus {
  const { component, artifact, installed, running, lastError } = input;
  const state: ComponentState = !artifact
    ? 'unsupported'
    : !installed
      ? 'not_installed'
      : installed.version !== component.version || installed.sha256 !== artifact.sha256
        ? 'update_available'
        : installed.licence.notice.sha256 === component.licence.notice.sha256
          ? 'installed'
          : 'notice_outdated';
  const progress = running?.progress;
  return {
    id: component.id,
    name: component.name,
    kind: component.kind,
    version: component.version,
    tiers: component.tiers,
    ...(component.requires ? { requires: component.requires } : {}),
    licence: component.licence,
    state,
    installing: running !== undefined,
    partialBytes: input.partialBytes,
    ...(progress ? { progress } : {}),
    ...(lastError ? { lastError } : {}),
    ...(installed ? { installed } : {}),
    ...(artifact ? { downloadBytes: artifact.size } : {}),
  };
}
