// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isId, stagedImportSchema, type StagedImport } from '@taalcut/core';

/** `<uploadId>.import.json` beside the staged bytes. Write, fsync, then rename. */
export async function writeImportJournal(dir: string, file: StagedImport): Promise<string> {
  const parsed = stagedImportSchema.parse(file);
  if (!isId(parsed.uploadId)) throw new Error('journal id');
  const target = join(dir, `${parsed.uploadId}.import.json`);
  const tmp = `${target}.tmp`;
  const handle = await open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(parsed));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, target);
  const dirHandle = await open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
  return target;
}

export function journalPath(dir: string, uploadId: string): string {
  return join(dir, `${uploadId}.import.json`);
}
