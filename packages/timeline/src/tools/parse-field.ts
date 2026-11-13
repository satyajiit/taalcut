// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A value a tool got (from the model, or read back from an artifact) checked against the schema it must meet. */
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { z } from 'zod';

/** `value` as `schema` reads it; `core.validation` naming `field`, with zod's first issue as the detail. */
export function parseField<S extends z.ZodType>(
  schema: S,
  value: unknown,
  field: string,
): Result<z.output<S>> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err(ValidationError({ field }, { detail: parsed.error.issues[0]?.message ?? '' }));
}
