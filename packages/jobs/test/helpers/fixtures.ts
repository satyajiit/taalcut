// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Temp folders, manifests and fake statfs functions shared by the tests. */
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { parseManifest, type ComponentManifest, type StatfsLike } from '@taalcut/jobs';
import { noticeUrlFor, TEST_NOTICE } from './content';

export const PLATFORM = 'darwin-arm64';

/** A licence as the manifest pins it: the spdx and the hosted NOTICE.txt's url, size and sha256. */
export const MIT_LICENCE = {
  spdx: 'MIT',
  notice: { url: 'https://components.example.invalid/x/1/NOTICE.txt', size: 1024, sha256: 'b'.repeat(64) },
};

/**
 * The managers and download sets a test opens over its folder. afterEach closes them, as the app does at quit,
 * before it deletes the folder: one still writing (a last failure forgotten just after an install) would make the
 * delete fail with ENOTEMPTY.
 */
export class OpenedInTest {
  private open: { close(): Promise<void> }[] = [];

  add<T extends { close(): Promise<void> }>(item: T): T {
    this.open.push(item);
    return item;
  }

  async closeAll(): Promise<void> {
    const open = this.open;
    this.open = [];
    await Promise.all(open.map((item) => item.close()));
  }
}

export function tempDir(prefix = 'taalcut-jobs-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Files under `dir`, recursively, as relative paths. Missing folder: []. */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => !e.isDirectory())
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
      .sort();
  } catch {
    return [];
  }
}

/** A volume with `freeBytes` free. */
export const diskWithFree =
  (freeBytes: number): StatfsLike =>
  async () => ({ bavail: BigInt(Math.floor(freeBytes / 4096)), bsize: 4096n });

export const plentyOfSpace = diskWithFree(1024 ** 4);

/** A Sleep that returns at once (backoff delays are asserted, not waited for). */
export const noSleep = async (_ms?: number, _signal?: AbortSignal): Promise<void> => undefined;

export interface FileComponentSpec {
  readonly id: string;
  readonly version?: string;
  readonly urls: readonly string[];
  readonly size: number;
  readonly sha256: string;
  readonly dependencies?: readonly string[];
  readonly tiers?: readonly string[];
  readonly platform?: string;
  readonly fileName?: string;
  readonly executable?: boolean;
  readonly archive?: {
    format: 'tar' | 'tar.gz' | 'tar.zst';
    extractedSize: number;
    stripComponents?: number;
  };
  /** Its licence notice. Default: the test server's, beside its first url (TEST_NOTICE). */
  readonly notice?: { readonly url: string; readonly size: number; readonly sha256: string };
  /** What the machine must have (seam 4), and the accelerator builds that stand in for it. */
  readonly requires?: Record<string, unknown>;
  readonly variants?: readonly string[];
  /** Terms the person accepts before it downloads (LNX1-TRM, `licence.acceptance`). */
  readonly acceptance?: Record<string, unknown>;
}

export function componentJson(spec: FileComponentSpec): Record<string, unknown> {
  const [url] = spec.urls;
  if (url === undefined) throw new Error(`${spec.id}: a test component needs a url`);
  const install = spec.archive
    ? { type: 'archive', ...spec.archive }
    : { type: 'file', fileName: spec.fileName ?? `${spec.id}.bin`, executable: spec.executable ?? false };
  return {
    id: spec.id,
    name: spec.id,
    version: spec.version ?? '1.0.0',
    kind: 'model',
    tiers: spec.tiers ?? [],
    licence: {
      spdx: 'MIT',
      notice: spec.notice ?? {
        url: noticeUrlFor(url),
        size: TEST_NOTICE.size,
        sha256: TEST_NOTICE.sha256(),
      },
      ...(spec.acceptance ? { acceptance: spec.acceptance } : {}),
    },
    dependencies: spec.dependencies ?? [],
    ...(spec.requires ? { requires: spec.requires } : {}),
    ...(spec.variants ? { variants: spec.variants } : {}),
    artifacts: [
      { platform: spec.platform ?? 'any', urls: spec.urls, sha256: spec.sha256, size: spec.size, install },
    ],
  };
}

export function manifestOf(...components: FileComponentSpec[]): ComponentManifest {
  return unwrap(parseManifest({ schemaVersion: 1, components: components.map(componentJson) }));
}
