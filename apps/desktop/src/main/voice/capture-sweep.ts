// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The TTL sweep: captures started before `cutoff` leave the table, and their files go unless they were claimed
 * (a claimed file is the consent store's now). Capture files this run doesn't know (an earlier run's) go once
 * they are older than `cutoff`. Other files in the folder are never touched.
 */
import type { Capture } from './capture-table';
import type { CaptureFiles } from './capture-files';

export async function sweepCaptures(
  captures: Map<string, Capture>,
  files: Pick<CaptureFiles, 'list' | 'remove'>,
  cutoff: number,
): Promise<void> {
  for (const capture of [...captures.values()]) {
    if (capture.startedAt > cutoff) continue;
    captures.delete(capture.id);
    if (capture.state !== 'claimed') await files.remove(capture.id);
  }
  for (const file of await files.list())
    if (!captures.has(file.id) && file.modifiedAt <= cutoff) await files.remove(file.id);
}
