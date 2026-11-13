// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tag text the library stores (P3-V14): core's templateTagSchema, so `शादी` is a tag. */
import { err, ok, templateTagSchema, type Result } from '@taalcut/core';
import { TagInvalid } from '../errors';

export function normaliseTag(tag: string): Result<string> {
  const parsed = templateTagSchema.safeParse(tag);
  if (parsed.success) return ok(parsed.data);
  return err(TagInvalid({ tag: tag.normalize('NFC').trim().slice(0, 32) }));
}
