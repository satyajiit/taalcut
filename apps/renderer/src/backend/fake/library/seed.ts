// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic building blocks for the fake library: the same seed gives the
 * same 5,000 clips on every run, so screenshots and end-to-end checks are
 * stable. Ids are real ULIDs (core's idSchema checks them); derived-file keys
 * match core's DERIVED_KEY_PATTERN, so the fake's payloads pass the contract.
 */
import type { Id } from '@taalcut/core';

/** mulberry32: small, fast and good enough for fixtures. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A valid ULID for entity `kind` (0–31) and number `n`: the same inputs always give the same id. */
export function fakeUlid<E extends string>(kind: number, n: number): Id<E> {
  let tail = '';
  let rest = n;
  for (let i = 0; i < 12; i += 1) {
    tail = CROCKFORD[rest % 32] + tail;
    rest = Math.floor(rest / 32);
  }
  return `01K7C5M6Q8${CROCKFORD[kind % 32]}${'000'}${tail}` as Id<E>;
}

/** The number fakeUlid encoded, or null for an id it didn't make. */
export function ulidNumber(id: string, kind: number): number | null {
  if (id.length !== 26 || !id.startsWith('01K7C5M6Q8') || id[10] !== CROCKFORD[kind % 32]) return null;
  let n = 0;
  for (const char of id.slice(14)) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) return null;
    n = n * 32 + digit;
  }
  return n;
}

/** 64 hex characters from a number, for content hashes and derived-file keys. */
export function fakeHash(n: number, salt = 0): string {
  const random = prng(n * 7919 + salt * 104_729 + 17);
  let hex = '';
  while (hex.length < 64)
    hex += Math.floor(random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, '0');
  return hex.slice(0, 64);
}

/** The scene number a derived key was made for, so the media fake can draw it again. */
export function sceneOfKey(key: string): number {
  const match = /\/([0-9a-f]{64})\./.exec(key);
  return match ? Number.parseInt(match[1]!.slice(0, 4), 16) : 0;
}

/** A hash whose first four hex digits carry `scene` (and the rest is noise). */
export function sceneHash(scene: number, n: number, salt = 0): string {
  return scene.toString(16).padStart(4, '0') + fakeHash(n, salt).slice(4);
}
