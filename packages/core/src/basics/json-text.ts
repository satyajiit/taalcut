// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * JSON text read at a boundary (a process's answer, a file, a TEXT column, a provider's body). Text that is not
 * JSON reads as `undefined`, which every zod schema refuses, so the caller's schema decides; nothing here trusts
 * the shape.
 */
import type { z } from 'zod';

export function jsonFromText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON is a value the caller's schema refuses, not an error to raise here.
    return undefined;
  }
}

/** The parsed value, or null when the text is not JSON or does not match `schema`. */
export function parseJsonWith<S extends z.ZodType>(schema: S, text: string): z.output<S> | null {
  const parsed = schema.safeParse(jsonFromText(text));
  return parsed.success ? parsed.data : null;
}
