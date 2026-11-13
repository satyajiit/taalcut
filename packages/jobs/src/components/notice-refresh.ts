// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A saved licence notice the manifest has since replaced (UX2-DOWNLOADER round 4). A notice's key is its content
 * (`NOTICE-<sha256 prefix>.txt`), so the host can correct one (Deno's, llama.cpp's at sequence 16) while the
 * component's version and files stay as they are. An installed component whose files are current but whose saved
 * notice isn't gets the new one: fetched and verified like any notice, then renamed over the saved copy in one step
 * (the old notice until that instant, the new one after) and recorded in the registry. Its files aren't touched or
 * fetched again. A notice that doesn't arrive or doesn't match leaves the old one where it is.
 */
import { chmod, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { InstallFailed } from './errors';
import { describeCause } from './http';
import { downloadNotice, type InstallContext } from './install-one';
import type { ComponentEntry } from './manifest';
import { ProgressReporter, type ProgressListener } from './progress';
import type { InstalledEntry } from './registry';

/** Replaces `entry`'s saved notice with the manifest's, leaving its files alone. Returns the updated entry. */
export async function refreshNotice(
  ctx: InstallContext,
  component: ComponentEntry,
  entry: InstalledEntry,
  signal: AbortSignal,
  onProgress: ProgressListener,
): AsyncResult<InstalledEntry> {
  const reporter = new ProgressReporter({
    componentId: component.id,
    version: component.version,
    installType: 'file',
    onProgress,
    intervalMs: ctx.progressIntervalMs,
    now: ctx.now,
  });
  reporter.update('checking', 0, 0);
  const notice = await downloadNotice(ctx, component, signal, reporter, true);
  if (!notice.ok) return notice;
  if (signal.aborted) return err(CancelledError());
  reporter.update('installing', 0, 1);
  try {
    await chmod(notice.value.path, 0o644);
    // One rename over the saved copy: nothing ever finds the folder without a notice, or with half of one.
    await rename(notice.value.path, join(ctx.layout.root, entry.dir, entry.notice));
    const next: InstalledEntry = {
      ...entry,
      bytes: entry.bytes - entry.licence.notice.size + component.licence.notice.size,
      licence: component.licence,
    };
    await ctx.registry.put(next);
    reporter.update('installing', 1, 1);
    return ok(next);
  } catch (cause) {
    return err(
      InstallFailed({ component: component.id }, { detail: `licence notice: ${describeCause(cause)}` }),
    );
  }
}
