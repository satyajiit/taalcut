// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { z } from 'zod';
import type { SqlRow } from '../driver/types';

export function productRow<T>(row: SqlRow, schema: z.ZodType<T>): Result<T> {
  try {
    const parsed = schema.safeParse(JSON.parse(String(row['body_json'])));
    return parsed.success
      ? ok(parsed.data)
      : err(ValidationError({ field: 'product' }, { detail: 'Invalid stored product record' }));
  } catch {
    return err(ValidationError({ field: 'product' }, { detail: 'Unreadable product record' }));
  }
}
export function productRows<T>(rows: readonly SqlRow[], schema: z.ZodType<T>): Result<T[]> {
  const items: T[] = [];
  for (const row of rows) {
    const item = productRow(row, schema);
    if (!item.ok) return item;
    items.push(item.value);
  }
  return ok(items);
}
