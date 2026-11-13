// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bytes read from the bulk-in pipe and not yet decoded. Transfers are kept as they came and copied
 * once, into the container they belong to, so a phone that answers in small transfers costs linear
 * time, not a re-copy of the growing buffer on every read.
 */
export class Inbox {
  private parts: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  push(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    this.parts.push(bytes);
    this.size += bytes.byteLength;
  }

  /** The little-endian UINT32 at the front (a container's length), or null with fewer than 4 bytes. */
  peekUint32(): number | null {
    if (this.size < 4) return null;
    const head = this.take(4);
    this.parts.unshift(head);
    this.size += 4;
    return new DataView(head.buffer, head.byteOffset, 4).getUint32(0, true);
  }

  /** Removes the first `count` bytes (at most `length`) as one array. */
  take(count: number): Uint8Array {
    const out = new Uint8Array(Math.min(count, this.size));
    let filled = 0;
    while (filled < out.byteLength) {
      const head = this.parts[0];
      if (!head) break;
      const want = out.byteLength - filled;
      if (head.byteLength <= want) {
        out.set(head, filled);
        filled += head.byteLength;
        this.parts.shift();
      } else {
        out.set(head.subarray(0, want), filled);
        this.parts[0] = head.subarray(want);
        filled += want;
      }
    }
    this.size -= filled;
    return out;
  }

  clear(): void {
    this.parts = [];
    this.size = 0;
  }
}
