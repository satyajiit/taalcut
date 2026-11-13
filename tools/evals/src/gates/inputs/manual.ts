// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { readJson } from '../../files';
import { sourceOf } from './digest';
import { parseWith } from './parse';
import { type ManualInput } from './types';

const rowSchema = z.strictObject({
  gate: z.enum(['beta', 'v1']),
  row: z.number().int().positive(),
  pass: z.boolean(),
  signedBy: z.string().min(1),
  at: z.string().min(1),
  evidence: z.string().min(1),
});

const fileSchema = z.strictObject({
  synthetic: z.boolean(),
  rows: z.array(rowSchema),
});

export function loadManual(path: string): ManualInput {
  const parsed = parseWith(fileSchema, readJson(path), path);
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const key = `${row.gate}:${row.row}`;
    if (seen.has(key)) throw new Error(`${path} signs ${key} more than once`);
    seen.add(key);
  }
  return {
    kind: 'present',
    synthetic: parsed.synthetic,
    rows: parsed.rows,
    source: sourceOf(path, parsed.synthetic),
  };
}
