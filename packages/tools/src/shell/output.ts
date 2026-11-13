// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a shell call keeps of its output, without holding more than its limit: the head and the tail of stdout (a
 * command's first lines say what it is doing, its last ones how it ended), the tail of stderr. Text is UTF-8 cut on
 * character boundaries. Everything here is the child's: untrusted.
 */

const decoder = () => new TextDecoder('utf-8', { fatal: false });

/** Starts on a character boundary (skips UTF-8 continuation bytes). */
function fromBoundary(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length && start < 4 && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start);
}

/** Ends on a character boundary (drops a character cut in half). */
function toBoundary(bytes: Buffer): Buffer {
  return Buffer.from(decoder().decode(bytes).replace(/�$/, ''), 'utf8');
}

export interface Captured {
  push(chunk: Buffer): void;
  /** The kept text; a cut in the middle is marked with how many bytes it dropped. */
  text(): string;
  /** Every byte the stream carried. */
  readonly total: number;
}

/** Keeps a third of `limit` from the start and the rest from the end. */
export function headAndTail(limit: number): Captured {
  const headLimit = Math.floor(limit / 3);
  const tailLimit = limit - headLimit;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let total = 0;
  return {
    push(chunk) {
      total += chunk.length;
      let rest = chunk;
      if (head.length < headLimit) {
        const take = Math.min(headLimit - head.length, rest.length);
        head = Buffer.concat([head, rest.subarray(0, take)]);
        rest = rest.subarray(take);
      }
      if (rest.length === 0) return;
      tail = Buffer.concat([tail, rest]);
      if (tail.length > tailLimit * 2) tail = tail.subarray(tail.length - tailLimit);
    },
    text() {
      const kept = tail.length > tailLimit ? tail.subarray(tail.length - tailLimit) : tail;
      const cut = total - head.length - kept.length;
      const start = toBoundary(head).toString('utf8');
      const end = fromBoundary(kept).toString('utf8');
      return cut > 0 ? `${start}\n[… ${cut} bytes cut …]\n${end}` : start + end;
    },
    get total() {
      return total;
    },
  };
}

/** Keeps the last `limit` bytes. */
export function tailOnly(limit: number): Captured {
  let tail = Buffer.alloc(0);
  let total = 0;
  return {
    push(chunk) {
      total += chunk.length;
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > limit * 2) tail = tail.subarray(tail.length - limit);
    },
    text() {
      const kept = tail.length > limit ? tail.subarray(tail.length - limit) : tail;
      const text = fromBoundary(kept).toString('utf8');
      return total > kept.length ? `[… ${total - kept.length} bytes cut …]\n${text}` : text;
    },
    get total() {
      return total;
    },
  };
}
