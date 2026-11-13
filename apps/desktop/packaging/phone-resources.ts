// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The phone page, shipped at Contents/Resources/phone so the packaged lan
 * process can read it. tus.min.js sits beside index.html; phoneAssetsFromDir
 * serves that name.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSet } from 'electron-builder';

export function phoneResources(projectDir: string): FileSet[] {
  const root = join(projectDir, '..', '..', 'packages', 'transfer');
  const phone = join(root, 'phone');
  const tus = join(root, 'node_modules', 'tus-js-client', 'dist', 'tus.min.js');
  const sets: FileSet[] = [];
  if (existsSync(phone)) sets.push({ from: phone, to: 'phone' });
  // A single file is copied to a file path: `to: 'phone'` made electron-builder copy it onto the folder (EISDIR).
  if (existsSync(tus)) sets.push({ from: tus, to: join('phone', 'tus.min.js') });
  return sets;
}
