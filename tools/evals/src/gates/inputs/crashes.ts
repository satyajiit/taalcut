// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { readJson } from '../../files';
import { sourceOf } from './digest';
import { parseWith } from './parse';
import { type CrashesInput } from './types';

const rowSchema = z
  .strictObject({
    release: z.string().min(1),
    channel: z.string().min(1),
    sessions: z.number().int().nonnegative(),
    crashedSessions: z.number().int().nonnegative(),
  })
  .refine((row) => row.crashedSessions <= row.sessions, {
    message: 'crashedSessions exceeds sessions',
  });

/** The crash backend's export is a bare array. Generated fixtures wrap it as `{ synthetic: true, rows }`. */
const fileSchema = z.union([
  z.array(rowSchema).transform((rows) => ({ synthetic: false, rows })),
  z.strictObject({ synthetic: z.boolean(), rows: z.array(rowSchema) }),
]);

export function loadCrashes(path: string): CrashesInput {
  const parsed = parseWith(fileSchema, readJson(path), path);
  return { kind: 'present', rows: parsed.rows, source: sourceOf(path, parsed.synthetic) };
}
