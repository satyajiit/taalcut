// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Untrusted or stored values checked at render's boundaries (zod), as values: never a throw. */
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { z } from 'zod';

/** The parsed value, or `ValidationError` on `field` with zod's message (after `context`, trimmed). */
export function parsedAs<T>(schema: z.ZodType<T>, value: unknown, field: string, context = ''): Result<T> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field }, { detail: `${context}${parsed.error.message}`.slice(0, 2000) }));
}
