// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readRepoJson } from './json-file.mjs';

/** Hub documents are at most `maxBytes` (128 KiB, core's HUB_MAX_BYTES). Larger files are refused before JSON.parse. */
export const MAX_TEMPLATE_BYTES = readRepoJson('schema', 'content-rules.v0.json').maxBytes;

export function tooLarge(byteLength) {
  return byteLength > MAX_TEMPLATE_BYTES;
}
