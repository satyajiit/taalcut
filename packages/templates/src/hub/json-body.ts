// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A hub response body read as JSON, and optionally checked against its schema: `hub.invalid` when it isn't. */
import { err, ok, type Result } from '@taalcut/core';
import type { z } from 'zod';
import { hubInvalid, hubInvalidFrom } from './hub-invalid';

function jsonBody(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    // Not JSON: the body is refused as a whole; the parser's message names no field worth keeping.
    return err(hubInvalid([{ path: '', rule: 'schema' }]));
  }
}

export function jsonBodyOf<T>(schema: z.ZodType<T>, text: string): Result<T> {
  const body = jsonBody(text);
  if (!body.ok) return body;
  const parsed = schema.safeParse(body.value);
  return parsed.success ? ok(parsed.data) : err(hubInvalidFrom(parsed.error));
}
