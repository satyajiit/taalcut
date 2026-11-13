// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small JSON file the component manager keeps beside its registry (the last failure of each component, the
 * download of everything this Mac needs). Writes are atomic and one at a time, in the order asked. A missing file
 * is the default; one that doesn't parse is logged and read as the default, since the next write replaces it.
 */
import { readFile } from 'node:fs/promises';
import { createSerialQueue } from '@taalcut/core';
import type { z } from 'zod';
import { describeCause } from './http';
import { isErrnoException, writeFileAtomic } from './fs-util';

export type StateLog = (message: string) => void;

export class JsonState<T> {
  private readonly writes = createSerialQueue();

  constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T>,
    private readonly fallback: () => T,
    private readonly log: StateLog,
  ) {}

  async read(): Promise<T> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (cause) {
      if (!isErrnoException(cause, 'ENOENT')) this.log(`[components] ${this.path}: ${describeCause(cause)}`);
      return this.fallback();
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      this.log(`[components] ${this.path} is not JSON, read as empty: ${describeCause(cause)}`);
      return this.fallback();
    }
    const parsed = this.schema.safeParse(json);
    if (parsed.success) return parsed.data;
    this.log(`[components] ${this.path} doesn't match its schema, read as empty`);
    return this.fallback();
  }

  /**
   * Writes `value` after any write before it. A write that fails is logged and resolves false: what is kept in
   * memory still holds for this run, and the next write tries again.
   */
  write(value: T): Promise<boolean> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    return this.writes
      .run(() => writeFileAtomic(this.path, text))
      .then(
        () => true,
        (cause: unknown) => {
          this.log(`[components] couldn't save ${this.path}: ${describeCause(cause)}`);
          return false;
        },
      );
  }

  /** Resolves once every write asked so far has settled. */
  settled(): Promise<void> {
    return this.writes.settled();
  }
}
