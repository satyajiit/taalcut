// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Size and nesting limits for a free-form JSON value that crosses IPC (a
 * command's payload), checked before it is forwarded. The walk stops as soon
 * as a limit is passed, so a huge, deep or cyclic value costs no more than
 * the limits themselves.
 */

export interface JsonLimits {
  /** About the size of the value written as JSON, in UTF-8 bytes (string escapes aren't counted). */
  readonly maxBytes: number;
  /** How many arrays or objects may nest: 1 allows `{ "a": 1 }` but not `{ "a": [] }`. */
  readonly maxDepth: number;
}

/** UTF-8 bytes of `text` as a JSON string, quotes included; stops counting once past `limit`. */
function stringBytes(text: string, limit: number): number {
  let bytes = 2;
  for (let i = 0; i < text.length && bytes <= limit; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4; // A surrogate pair: one 4-byte character.
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function scalarBytes(value: unknown): number {
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value).length;
  return 4; // null; undefined, functions and symbols become null or nothing.
}

/** Whether `value` stays within `limits` (see JsonLimits). */
export function withinJsonLimits(value: unknown, limits: JsonLimits): boolean {
  let bytes = 0;
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const next = pending.pop()!;
    const current = next.value;
    if (typeof current === 'string') bytes += stringBytes(current, limits.maxBytes - bytes);
    else if (current === null || typeof current !== 'object') bytes += scalarBytes(current);
    else {
      if (next.depth >= limits.maxDepth) return false;
      bytes += 2; // [] or {}
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length && bytes <= limits.maxBytes; i++) {
          if (i > 0) bytes += 1;
          pending.push({ value: current[i] as unknown, depth: next.depth + 1 });
        }
      } else {
        let first = true;
        for (const key in current) {
          if (!Object.hasOwn(current, key)) continue;
          if (bytes > limits.maxBytes) break;
          bytes += stringBytes(key, limits.maxBytes - bytes) + (first ? 1 : 2);
          first = false;
          pending.push({ value: (current as Record<string, unknown>)[key], depth: next.depth + 1 });
        }
      }
    }
    if (bytes > limits.maxBytes) return false;
  }
  return true;
}
