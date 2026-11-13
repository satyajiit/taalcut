// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { packageRoot } from './read-changes.mjs';

/** A file this repository ships beside the scripts (schema/…), read as JSON. */
export function readRepoJson(...segments) {
  return JSON.parse(readFileSync(path.join(packageRoot(), ...segments), 'utf8'));
}

/** Two-space JSON and a final newline, the way every file in this repository is written. */
export function writeJsonFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
