// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Committed `goldens/render/<id>/timeline.json` plans. Media is not stored. */
export function committedRenderDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../goldens/render');
}

export function listCommittedRenderIds(root = committedRenderDir()): string[] {
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${root}: ${message}`, { cause: error });
  }
  return names.filter((name) => existsSync(join(root, name, 'timeline.json')));
}

/** Copy the committed plans. Does not render the long timelines. */
export function writeRenderFixtures(outDir: string, root = committedRenderDir()): string[] {
  const ids = listCommittedRenderIds(root);
  if (ids.length === 0) throw new Error(`No render goldens in ${root}`);
  for (const id of ids) {
    const text = readFileSync(join(root, id, 'timeline.json'));
    const dest = join(outDir, id, 'timeline.json');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  return ids;
}
