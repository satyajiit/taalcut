// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One asset's part of the frame cache: the frame files decodes wrote for it
 * (kept as they are, indexed by set and grid frame) and small JSON documents
 * (the analysis pass's results). Every byte goes through the cache's budget,
 * so a file that would pass the asset's or the cache's bound is deleted
 * instead of kept: the frames it held are decoded again when asked for.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { CacheUnavailable } from '../errors';
import { readSlots, type FrameFile, type FrameSlot } from '../frame-sets/frame-files';

/** What an entry asks of its cache: room under both bounds, and the bytes back when it shrinks. */
export interface FrameBudget {
  reserve(entry: AssetFrames, bytes: number): Promise<boolean>;
  free(bytes: number): void;
}

export interface FrameLocation {
  readonly file: FrameFile;
  readonly slot: FrameSlot;
}

export interface AssetFrames {
  readonly asset: string;
  /** Where decodes for this asset write their files. */
  readonly dir: string;
  readonly bytes: number;
  /** Keeps a decoded file; false, and the file deleted, when it would pass a bound. */
  adopt(file: FrameFile): Promise<boolean>;
  /** The cached frames of `set` among `indexes`. */
  find(set: string, indexes: readonly number[]): Map<number, FrameLocation>;
  /** The bytes of the cached frames of `set` among `indexes` (missing ones are absent). */
  read(set: string, indexes: readonly number[]): AsyncResult<Map<number, Buffer>>;
  /** Keeps a small JSON document; false when it would pass a bound. */
  putDoc(name: string, value: unknown): AsyncResult<boolean>;
  getDoc(name: string): AsyncResult<unknown>;
}

const DOC_NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export function createAssetFrames(asset: string, dir: string, budget: FrameBudget): AssetFrames {
  const sets = new Map<string, Map<number, FrameLocation>>();
  const docs = new Map<string, number>();
  let bytes = 0;

  const self: AssetFrames = {
    asset,
    dir,
    get bytes() {
      return bytes;
    },
    async adopt(file) {
      if (!(await budget.reserve(self, file.bytes))) {
        await rm(file.path, { force: true });
        return false;
      }
      bytes += file.bytes;
      const frames = sets.get(file.set) ?? new Map<number, FrameLocation>();
      for (const slot of file.slots) frames.set(slot.index, { file, slot });
      sets.set(file.set, frames);
      return true;
    },
    find(set, indexes) {
      const frames = sets.get(set);
      const found = new Map<number, FrameLocation>();
      if (!frames) return found;
      for (const index of indexes) {
        const location = frames.get(index);
        if (location) found.set(index, location);
      }
      return found;
    },
    async read(set, indexes) {
      const byFile = new Map<string, FrameSlot[]>();
      for (const { file, slot } of self.find(set, indexes).values()) {
        byFile.set(file.path, [...(byFile.get(file.path) ?? []), slot]);
      }
      const out = new Map<number, Buffer>();
      for (const [path, slots] of byFile) {
        const read = await readSlots(path, slots);
        if (!read.ok) return read;
        for (const [index, data] of read.value) out.set(index, data);
      }
      return ok(out);
    },
    async putDoc(name, value) {
      if (!DOC_NAME.test(name))
        return err(CacheUnavailable(undefined, { detail: `bad document name ${name}` }));
      const body = Buffer.from(JSON.stringify(value));
      const previous = docs.get(name) ?? 0;
      if (body.length > previous && !(await budget.reserve(self, body.length - previous))) return ok(false);
      try {
        await writeFile(join(dir, `${name}.json`), body);
      } catch (cause) {
        if (body.length > previous) budget.free(body.length - previous);
        return err(
          CacheUnavailable(undefined, { detail: cause instanceof Error ? cause.message : 'write failed' }),
        );
      }
      if (body.length < previous) budget.free(previous - body.length);
      bytes += body.length - previous;
      docs.set(name, body.length);
      return ok(true);
    },
    async getDoc(name) {
      if (!docs.has(name)) return ok(undefined);
      try {
        return ok(JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')) as unknown);
      } catch (cause) {
        return err(
          CacheUnavailable(undefined, { detail: cause instanceof Error ? cause.message : 'read failed' }),
        );
      }
    },
  };
  return self;
}
