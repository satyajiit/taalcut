// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content hashes for the result cache and the run log: the same tool, version
 * and input always give the same hash, whatever the key order.
 */
import { createHash } from 'node:crypto';

/**
 * JSON with object keys sorted, so equal values serialise identically. Follows
 * JSON.stringify for everything else: undefined and functions are dropped from
 * objects and become null in arrays, and toJSON() is honoured.
 */
export function canonicalJson(value: unknown): string {
  return write(value) ?? 'null';
}

function write(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return write((value as { toJSON(): unknown }).toJSON());
  }
  if (Array.isArray(value)) return `[${value.map((item) => write(item) ?? 'null').join(',')}]`;
  const parts: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const item = write((value as Record<string, unknown>)[key]);
    if (item !== undefined) parts.push(`${JSON.stringify(key)}:${item}`);
  }
  return `{${parts.join(',')}}`;
}

/** sha256 (hex) of the canonical JSON of `value`. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** The cache key of a call: content hash of (tool, version, input). */
export function toolInputHash(
  tool: { readonly name: string; readonly version: string },
  input: unknown,
): string {
  return contentHash({ tool: tool.name, version: tool.version, input });
}
