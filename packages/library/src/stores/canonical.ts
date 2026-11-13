// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Canonical JSON and hashes for the stores: the same value always hashes the same. */
import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level (arrays keep their order); undefined fields are left out. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const field = (value as Record<string, unknown>)[key];
    if (field !== undefined) out[key] = sortKeys(field);
  }
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** NFC, trimmed; undefined when nothing is left. */
export function cleanText(text: string): string | undefined {
  const clean = text.normalize('NFC').trim();
  return clean ? clean : undefined;
}

/**
 * An FTS5 MATCH expression from user text: each word a quoted prefix term, all required. User text never
 * reaches FTS syntax unquoted. Undefined when the text has no word.
 */
export function ftsPrefixQuery(text: string): string | undefined {
  const words = text
    .normalize('NFC')
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
    .slice(0, 16);
  return words.length === 0 ? undefined : words.map((word) => `"${word}"*`).join(' ');
}

/** Opaque keyset cursors: `<epoch ms>:<id>`, base64url so they read as tokens, not as something to edit. */
export function encodeCursor(at: number, id: string): string {
  return Buffer.from(`${at}:${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { at: number; id: string } | undefined {
  if (!cursor) return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = text.indexOf(':');
  const at = Number(text.slice(0, split));
  if (split < 1 || !Number.isSafeInteger(at)) return undefined;
  return { at, id: text.slice(split + 1) };
}
