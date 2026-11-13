// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic file content of any size, generated on the fly so a 500 MB
 * "file" costs 2 MiB of memory and no disk. Byte i depends only on (seed, i),
 * so any range can be served without generating what comes before it.
 */
import { createHash } from 'node:crypto';

const BLOCK = 1024 * 1024;

export interface Content {
  readonly size: number;
  chunks(start?: number, end?: number): Iterable<Buffer>;
}

export class DeterministicContent implements Content {
  private readonly doubled: Buffer;
  private digest: string | undefined;

  constructor(
    readonly size: number,
    seed: string,
  ) {
    const base = Buffer.alloc(BLOCK);
    for (let offset = 0, counter = 0; offset < BLOCK; offset += 32, counter++) {
      createHash('sha256').update(`${seed}:${counter}`).digest().copy(base, offset);
    }
    this.doubled = Buffer.concat([base, base]);
  }

  /** Block i is the base block rotated by a block-dependent amount: a zero-copy view. */
  private block(index: number): Buffer {
    const rotation = (index * 7919 * 4099) % BLOCK;
    return this.doubled.subarray(rotation, rotation + BLOCK);
  }

  *chunks(start = 0, end = this.size): Iterable<Buffer> {
    let position = start;
    while (position < end) {
      const index = Math.floor(position / BLOCK);
      const inBlock = position - index * BLOCK;
      const length = Math.min(BLOCK - inBlock, end - position);
      yield this.block(index).subarray(inBlock, inBlock + length);
      position += length;
    }
  }

  sha256(): string {
    if (this.digest === undefined) {
      const hash = createHash('sha256');
      for (const chunk of this.chunks()) hash.update(chunk);
      this.digest = hash.digest('hex');
    }
    return this.digest;
  }
}

/** Content from an in-memory buffer (archives built in a test). */
export class BufferContent implements Content {
  constructor(private readonly data: Buffer) {}

  get size(): number {
    return this.data.length;
  }

  *chunks(start = 0, end = this.data.length): Iterable<Buffer> {
    for (let position = start; position < end; position += 64 * 1024) {
      yield this.data.subarray(position, Math.min(end, position + 64 * 1024));
    }
  }

  sha256(): string {
    return createHash('sha256').update(this.data).digest('hex');
  }
}

export function sha256Of(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The licence notice the test server keeps beside every file it serves (`<path>.NOTICE.txt`), as the host keeps a
 * NOTICE.txt beside each component; test manifests pin it (fixtures.ts).
 */
export const TEST_NOTICE = new BufferContent(
  Buffer.from('A test component\n\nMIT License\n\nPermission is hereby granted, free of charge, …\n'),
);

/** Where a file's licence notice is served and pinned: beside it. */
export const noticeUrlFor = (url: string): string => `${url}.NOTICE.txt`;
