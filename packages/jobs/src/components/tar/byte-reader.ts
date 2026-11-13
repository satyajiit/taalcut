// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Exact-size reads over a chunked byte stream, so tar entries can be streamed to disk. */

/** A corrupt, truncated or unsafe archive. The message is developer detail. */
export class TarError extends Error {
  override readonly name = 'TarError';
}

export class ByteReader {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private ended = false;
  private readonly iterator: AsyncIterator<Uint8Array>;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  /** Exactly `n` bytes, or undefined at a clean end of input. A short read is a TarError. */
  async read(n: number): Promise<Buffer | undefined> {
    while (this.buffered < n && (await this.pull()));
    if (this.buffered === 0) return undefined;
    if (this.buffered < n) throw new TarError('unexpected end of archive');
    return this.take(n);
  }

  /** The next `n` bytes in pieces, never all in memory at once. */
  async *stream(n: number): AsyncGenerator<Buffer> {
    let left = n;
    while (left > 0) {
      if (this.buffered === 0 && !(await this.pull())) throw new TarError('unexpected end of archive');
      const first = this.chunks[0];
      if (!first) continue;
      const piece = first.length <= left ? first : first.subarray(0, left);
      this.advance(piece.length);
      left -= piece.length;
      yield piece;
    }
  }

  async skip(n: number): Promise<void> {
    for await (const piece of this.stream(n)) void piece;
  }

  /** Consumes whatever is left (tar pads archives with zero blocks after the end marker). */
  async drain(): Promise<void> {
    this.chunks = [];
    this.buffered = 0;
    while (await this.pull()) {
      this.chunks = [];
      this.buffered = 0;
    }
  }

  private async pull(): Promise<boolean> {
    if (this.ended) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    const value = next.value;
    const chunk = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    return true;
  }

  private take(n: number): Buffer {
    const first = this.chunks[0]!;
    if (first.length >= n) {
      const out = first.subarray(0, n);
      this.advance(n);
      return out;
    }
    const parts: Buffer[] = [];
    let need = n;
    while (need > 0) {
      const chunk = this.chunks[0]!;
      const piece = chunk.length <= need ? chunk : chunk.subarray(0, need);
      parts.push(piece);
      this.advance(piece.length);
      need -= piece.length;
    }
    return Buffer.concat(parts, n);
  }

  private advance(n: number): void {
    const first = this.chunks[0]!;
    if (n >= first.length) this.chunks.shift();
    else this.chunks[0] = first.subarray(n);
    this.buffered -= n;
  }
}
