// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.sweepStaging` (jobs process, at start and daily): imports any
 * upload whose journal (`<uploadId>.import.json`) a crash left in the staging
 * folder, and deletes what no import will claim: staged partials older than
 * 7 days with no journal, and outcome markers older than 7 days.
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, stagedImportSchema, type AsyncResult, type ImportSink } from '@taalcut/core';
import { jsonFromText } from '../db/json-text';

export const STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const JOURNAL = '.import.json';
const DONE = '.done.json';

export async function sweepStaging(
  sink: ImportSink,
  options: {
    readonly now: () => number;
    readonly signal?: AbortSignal;
    readonly log?: (message: string) => void;
  },
): AsyncResult<{ imported: number; removed: number }> {
  const staging = await sink.staging();
  // The originals drive is unplugged: nothing to sweep now; the next run will.
  if (!staging.ok) return ok({ imported: 0, removed: 0 });
  const { dir } = staging.value;
  const names = await readdir(dir).catch(() => [] as string[]);
  let imported = 0;
  let removed = 0;

  const journals = new Set(names.filter((n) => n.endsWith(JOURNAL)).map((n) => n.slice(0, -JOURNAL.length)));
  for (const uploadId of journals) {
    if (options.signal?.aborted) break;
    const text = await readFile(join(dir, `${uploadId}${JOURNAL}`), 'utf8').catch(() => undefined);
    const parsed = text === undefined ? undefined : stagedImportSchema.safeParse(jsonFromText(text));
    if (!parsed?.success) {
      options.log?.(`staging: journal ${uploadId} doesn't parse; left for a person to look at`);
      continue;
    }
    const outcome = await sink.importStaged(parsed.data, options.signal ? { signal: options.signal } : {});
    if (outcome.ok) imported += 1;
    else options.log?.(`staging: ${uploadId} not imported: ${outcome.error.code}`);
  }

  const cutoff = options.now() - STAGING_RETENTION_MS;
  for (const name of names) {
    if (name.endsWith(JOURNAL) || name.endsWith('.tmp')) continue;
    // A tus upload is `<uploadId>` plus `<uploadId>.json`; markers are `<uploadId>.done.json` and `.dest`.
    const uploadId = name.split('.')[0]!;
    if (journals.has(uploadId) && !name.endsWith(DONE)) continue;
    const info = await stat(join(dir, name)).catch(() => undefined);
    if (!info?.isFile() || info.mtimeMs > cutoff) continue;
    await rm(join(dir, name), { force: true });
    removed += 1;
  }
  return ok({ imported, removed });
}
