// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The phone page directory for phoneAssetsFromDir.
 *
 * This file lives in src/utility/, the same depth as the compiled
 * out/utility/lan.mjs, so one relative path reaches packages/transfer/phone
 * from the source module and from the bundle. A file under roots/ is one
 * level deeper; that candidate is the fallback. A packaged app ships the
 * directory at Contents/Resources/phone (see packaging/phone-resources.ts).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FROM_UTILITY = '../../../../packages/transfer/phone';

export function transferPhoneDir(moduleUrl: string = import.meta.url): string {
  const here = dirname(fileURLToPath(moduleUrl));
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'phone') : '';
  const candidates = [packaged, join(here, FROM_UTILITY), join(here, '..', FROM_UTILITY)].filter(
    (dir) => dir.length > 0,
  );
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? join(here, FROM_UTILITY);
}
