// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: ids the edit eval's world mints in a fixed order, so a recorded session replays against the same ids
 * (a model's call names the clip a split made). Valid ULIDs (Crockford base32, 26 characters), never random, but
 * looking it: ids that differed only in their last letter (…0005, …0006) were mixed up by the 9B, as real ids
 * seldom are.
 */
import type { Id } from '@taalcut/core';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Twenty base32 letters from the family and `n` (FNV-1a, then xorshift): the same every run. */
function scrambled(prefix: string, n: number): string {
  let state = 0x811c9dc5;
  for (const char of `${prefix}:${n}`) state = Math.imul(state ^ char.charCodeAt(0), 0x01000193) >>> 0;
  let letters = '';
  for (let index = 0; index < 20; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    letters += ALPHABET[state % 32];
  }
  return letters;
}

/**
 * The id `n` of a family: six letters of prefix, then twenty scrambled (no count at the end: a model matched an id's
 * last digits to the numbers of the fenced blocks after a tool's JSON).
 */
export function fixedId<Entity extends string>(prefix: string, n: number): Id<Entity> {
  return `${prefix}${scrambled(prefix, n)}` as Id<Entity>;
}

/** A counter of fixed ids, from 1. */
export function idCounter<Entity extends string>(prefix: string): () => Id<Entity> {
  let n = 0;
  return () => fixedId<Entity>(prefix, ++n);
}
