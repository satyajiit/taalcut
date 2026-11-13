// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeps only the last `limit` bytes of a stream. FFmpeg's useful error is
 * almost always at the end of stderr, and a long encode can write megabytes.
 */
export class ByteTail {
  private chunks: Buffer[] = [];
  private size = 0;
  private truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    // Compact only when well over the limit, so most pushes are O(1).
    if (this.size > this.limit * 2) this.compact();
  }

  text(): string {
    this.compact();
    let text = (this.chunks[0] ?? Buffer.alloc(0)).toString('utf8');
    // When the start was cut off, drop the partial first line.
    if (this.truncated && text.includes('\n')) text = text.slice(text.indexOf('\n') + 1);
    return text.trimEnd();
  }

  private compact(): void {
    const all = Buffer.concat(this.chunks);
    if (all.length > this.limit) this.truncated = true;
    const kept = all.length > this.limit ? all.subarray(all.length - this.limit) : all;
    this.chunks = [kept];
    this.size = kept.length;
  }
}
