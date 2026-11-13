// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type SourceRef } from './types';

export function hashFile(path: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${path}: ${message}`, { cause: error });
  }
  return createHash('sha256').update(bytes).digest('hex');
}

export function sourceOf(path: string, synthetic: boolean): SourceRef {
  return { path, sha256: hashFile(path), synthetic };
}

export function readNdjsonBytes(path: string): { text: string; source: SourceRef } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${path}: ${message}`, { cause: error });
  }
  return {
    text: bytes.toString('utf8'),
    source: { path, sha256: createHash('sha256').update(bytes).digest('hex'), synthetic: false },
  };
}
