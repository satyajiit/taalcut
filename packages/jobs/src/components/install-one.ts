// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Installs one component: disk check, its licence notice (UX2-DOWNLOADER round 3: fetched and verified like an
 * artifact, a mismatch a failed download), resumable download, verify, extract into a staging folder with the
 * notice beside the files, rename into place, then record both in the registry. Until the registry write, the
 * previous version stays installed and in use.
 */
import { chmod, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { checkDiskSpace, type StatfsLike } from './disk';
import { downloadVerified, type DownloadOptions, type DownloadResult } from './download';
import { DiskSpaceLow, ExtractFailed, InstallFailed } from './errors';
import { fileSize, isErrnoException, pathExists, removeQuietly } from './fs-util';
import { describeCause } from './http';
import {
  downloadPathFor,
  installDirFor,
  newStagingDir,
  NOTICE_FILE,
  noticeDownloadPathFor,
  noticePartPathFor,
  partPathFor,
  type ComponentLayout,
} from './layout';
import type { ComponentArtifact, ComponentEntry } from './manifest';
import { ProgressReporter, type ProgressListener } from './progress';
import type { InstalledEntry, InstalledRegistry } from './registry';
import { refuseUnaccepted, type TermsBook } from './terms';
import { TarError } from './tar/byte-reader';
import { extractTar } from './tar/extract';

export interface InstallContext {
  readonly layout: ComponentLayout;
  readonly registry: InstalledRegistry;
  readonly platform: string;
  /** The person's acceptance of an owner's terms (terms.ts): a component that states some isn't installed without. */
  readonly terms: TermsBook | undefined;
  readonly statfs: StatfsLike;
  readonly headroomBytes: number;
  readonly download: Omit<DownloadOptions, 'signal' | 'onBytes' | 'onRetry'>;
  readonly progressIntervalMs?: number;
  readonly now: () => number;
}

/** Bytes still to download (the artifact and its licence notice) and to extract, given what is already on disk. */
export async function remainingNeed(
  layout: ComponentLayout,
  component: ComponentEntry,
  artifact: ComponentArtifact,
): Promise<{ downloadBytes: number; extractBytes: number }> {
  const { id, version } = component;
  const notice = component.licence.notice;
  const extractBytes = artifact.install.type === 'archive' ? artifact.install.extractedSize : 0;
  const artifactLeft = await leftToFetch(
    partPathFor(layout, id, version, artifact.sha256),
    downloadPathFor(layout, id, version, artifact.sha256),
    artifact.size,
  );
  const noticeLeft = await leftToFetch(
    noticePartPathFor(layout, id, version, notice.sha256),
    noticeDownloadPathFor(layout, id, version, notice.sha256),
    notice.size,
  );
  return { downloadBytes: artifactLeft + noticeLeft, extractBytes };
}

/** Bytes of one file still to fetch: none once its verified download is there, else what its part lacks. */
export async function leftToFetch(partPath: string, finalPath: string, size: number): Promise<number> {
  if ((await fileSize(finalPath)) === size) return 0;
  return Math.max(0, size - ((await fileSize(partPath)) ?? 0));
}

export async function installComponent(
  ctx: InstallContext,
  component: ComponentEntry,
  artifact: ComponentArtifact,
  signal: AbortSignal,
  onProgress: ProgressListener,
): AsyncResult<InstalledEntry> {
  const { id, version } = component;
  const { layout } = ctx;
  // The last guard (the manager checks the whole chain first): nothing of it downloads without the acceptance.
  const refused = await refuseUnaccepted([component], ctx.terms);
  if (refused) return err(refused);
  const reporter = new ProgressReporter({
    componentId: id,
    version,
    installType: artifact.install.type,
    onProgress,
    intervalMs: ctx.progressIntervalMs,
    now: ctx.now,
  });
  reporter.update('checking', 0, 0);

  const need = await remainingNeed(layout, component, artifact);
  const space = await checkDiskSpace({
    path: layout.root,
    component: id,
    needBytes: need.downloadBytes + need.extractBytes,
    headroomBytes: ctx.headroomBytes,
    statfs: ctx.statfs,
  });
  if (!space.ok) return space;

  // The notice first: it is small, so a notice that doesn't match fails before the artifact's bytes are fetched.
  const notice = await downloadNotice(ctx, component, signal, reporter);
  if (!notice.ok) return notice;
  const downloaded = await downloadVerified(
    { label: id, urls: artifact.urls, size: artifact.size, sha256: artifact.sha256 },
    partPathFor(layout, id, version, artifact.sha256),
    downloadPathFor(layout, id, version, artifact.sha256),
    {
      ...ctx.download,
      signal,
      onBytes: (phase, done, total) => reporter.update(phase, done, total),
      onRetry: ({ attempt, delayMs }) => reporter.reconnecting(attempt, delayMs),
    },
  );
  if (!downloaded.ok) return downloaded;
  if (signal.aborted) return err(CancelledError());

  const staging = newStagingDir(layout, id, version);
  try {
    await mkdir(staging, { recursive: true });
    const files = await stage(ctx, component, artifact, downloaded.value.path, staging, signal, reporter);
    const bytes = files.ok ? await placeNotice(component, notice.value.path, staging, files.value) : files;
    if (!bytes.ok) {
      await removeQuietly(staging);
      return bytes;
    }
    reporter.update('installing', 0, 1);
    const entry = await commit(ctx, component, artifact, staging, bytes.value);
    reporter.update('installing', 1, 1);
    return ok(entry);
  } catch (cause) {
    await removeQuietly(staging);
    return err(fsError(cause, id, signal, need.extractBytes));
  }
}

/**
 * Fetches the component's licence notice and checks it against `licence.notice` (size and sha256) like an artifact:
 * resumable, retried, and a mismatch is a failed download of the component, its detail naming the notice. Its bytes
 * are the progress only when the notice is all there is to fetch (`reportBytes`, a notice refresh).
 */
export async function downloadNotice(
  ctx: InstallContext,
  component: ComponentEntry,
  signal: AbortSignal,
  reporter: ProgressReporter,
  reportBytes = false,
): AsyncResult<DownloadResult> {
  const { id, version } = component;
  const notice = component.licence.notice;
  const fetched = await downloadVerified(
    { label: id, urls: [notice.url], size: notice.size, sha256: notice.sha256 },
    noticePartPathFor(ctx.layout, id, version, notice.sha256),
    noticeDownloadPathFor(ctx.layout, id, version, notice.sha256),
    {
      ...ctx.download,
      signal,
      ...(reportBytes ? { onBytes: (phase, done, total) => reporter.update(phase, done, total) } : {}),
      onRetry: ({ attempt, delayMs }) => reporter.reconnecting(attempt, delayMs),
    },
  );
  if (fetched.ok) return fetched;
  const detail = `licence notice ${notice.url}: ${fetched.error.detail ?? fetched.error.code}`;
  return err({ ...fetched.error, detail });
}

/** Moves the verified notice in beside the staged files. Returns the installed size, the notice included. */
async function placeNotice(
  component: ComponentEntry,
  noticePath: string,
  staging: string,
  bytes: number,
): AsyncResult<number> {
  const target = join(staging, NOTICE_FILE);
  // Never over a file of the component's own: its files stay exactly as published.
  if (await pathExists(target)) {
    const detail = `its files include ${NOTICE_FILE}, the name its licence notice is saved under`;
    return err(InstallFailed({ component: component.id }, { detail }));
  }
  await rename(noticePath, target);
  await chmod(target, 0o644);
  return ok(bytes + component.licence.notice.size);
}

/** Puts the files into `staging`. Returns the installed size. */
async function stage(
  ctx: InstallContext,
  component: ComponentEntry,
  artifact: ComponentArtifact,
  downloadPath: string,
  staging: string,
  signal: AbortSignal,
  reporter: ProgressReporter,
): AsyncResult<number> {
  const install = artifact.install;
  if (install.type === 'file') {
    const target = join(staging, install.fileName);
    await rename(downloadPath, target);
    await chmod(target, install.executable ? 0o755 : 0o644);
    return ok(artifact.size);
  }
  reporter.update('extracting', 0, artifact.size);
  try {
    const summary = await extractTar(downloadPath, staging, {
      format: install.format,
      stripComponents: install.stripComponents,
      maxBytes: install.extractedSize,
      signal,
      onProgress: (read) => reporter.update('extracting', Math.min(read, artifact.size - 1), artifact.size),
    });
    reporter.update('extracting', artifact.size, artifact.size);
    await removeQuietly(downloadPath);
    return ok(summary.bytes);
  } catch (cause) {
    if (isArchiveError(cause)) {
      // Downloading the same bytes again would fail the same way, so free the space.
      await removeQuietly(downloadPath);
      return err(ExtractFailed({ component: component.id }, { detail: describeCause(cause) }));
    }
    // Cancelled or a filesystem error: keep the verified download for the next attempt.
    return err(fsError(cause, component.id, signal, install.extractedSize));
  }
}

/** Renames staging into place and records it; the previous version is deleted only after that. */
async function commit(
  ctx: InstallContext,
  component: ComponentEntry,
  artifact: ComponentArtifact,
  staging: string,
  bytes: number,
): Promise<InstalledEntry> {
  const { layout, registry } = ctx;
  const dir = installDirFor(component.id, component.version, artifact.sha256);
  const finalDir = join(layout.root, dir);
  await mkdir(dirname(finalDir), { recursive: true });
  // Left behind by a crash between this rename and the registry write.
  await removeQuietly(finalDir);
  await rename(staging, finalDir);
  const previous = registry.get(component.id);
  const entry: InstalledEntry = {
    id: component.id,
    version: component.version,
    sha256: artifact.sha256,
    platform: ctx.platform,
    dir,
    ...(artifact.install.type === 'file' ? { file: artifact.install.fileName } : {}),
    bytes,
    installedAt: new Date(ctx.now()).toISOString(),
    licence: component.licence,
    notice: NOTICE_FILE,
  };
  await registry.put(entry);
  if (previous && previous.dir !== dir) await removeQuietly(join(layout.root, previous.dir));
  return entry;
}

function isArchiveError(cause: unknown): boolean {
  if (cause instanceof TarError) return true;
  // zlib reports bad gzip/zstd data with codes like Z_DATA_ERROR, Z_BUF_ERROR, ZSTD_error_*.
  const code = isErrnoException(cause) ? String(cause.code) : '';
  return code.startsWith('Z_') || code.toUpperCase().includes('ZSTD');
}

function fsError(
  cause: unknown,
  component: string,
  signal: AbortSignal,
  requiredBytes: number,
): TaalcutError {
  if (signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) return CancelledError();
  const detail = describeCause(cause);
  if (isErrnoException(cause, 'ENOSPC'))
    return DiskSpaceLow({ component, requiredBytes, availableBytes: 0 }, { detail });
  return InstallFailed({ component }, { detail });
}
