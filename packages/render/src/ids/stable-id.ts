// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ULID made from a seed: the same seed gives the same id. For ids that must not change between runs of the
 * same thing (a timeline's bumper items keep a composition's bytes and conform keys; a batch tool call keeps
 * its batch on a retry). Validated with core's parseId, never cast.
 */
import { createHash } from 'node:crypto';
import { parseId, type Id, type Result } from '@taalcut/core';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function stableId<Entity extends string>(seed: string): Result<Id<Entity>> {
  const digest = createHash('sha256').update(seed).digest();
  // The first character of a ULID is at most 7 (its 48-bit time).
  const chars = Array.from(
    { length: 26 },
    (_, index) => CROCKFORD[(digest[index] ?? 0) % (index === 0 ? 8 : 32)],
  ).join('');
  return parseId<Entity>(chars);
}
