// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type z } from 'zod';

export function parseWith<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${where} is not valid: ${parsed.error.message}`);
  }
  return parsed.data;
}
