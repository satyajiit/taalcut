// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3 review M11: the dest journal's rename into `.incoming` wasn't fsynced before the staged bytes moved
 * out, so a power loss could keep the move and lose the journal, and a retry then found neither the staged file
 * nor where it went. The staging folder is fsynced after each journal write, before anything relies on it.
 */
import { dirname, join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import type * as DurableFiles from '../../src/files/durable-files';
import { importer } from './fixture';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('../../src/files/durable-files', async (original) => {
  const real = await original<typeof DurableFiles>();
  return {
    ...real,
    writeDurably: async (path: string, ...rest: [string | Uint8Array, string?]) => {
      await real.writeDurably(path, ...rest);
      calls.push(`write ${path}`);
    },
    fsyncPath: async (path: string) => {
      await real.fsyncPath(path);
      calls.push(`fsync ${path}`);
    },
    moveFile: async (from: string, to: string) => {
      calls.push(`move ${from}`);
      await real.moveFile(from, to);
    },
  };
});

describe('ImportSink journals (M11)', () => {
  it('fsyncs the staging folder after the dest journal, before the staged bytes move', async () => {
    const t = await importer();
    const { file } = t.stage('IMG_1234.MOV');
    calls.length = 0;
    const outcome = unwrap(await t.sink.importStaged(file));
    const dest = join(t.dir, `${file.uploadId}.dest`);
    const done = join(t.dir, `${file.uploadId}.done.json`);
    const moved = join(t.root, '2026', '2026-10-12', 'IMG_1234.MOV');
    expect(calls).toEqual([
      `write ${dest}`,
      `fsync ${t.dir}`,
      `move ${file.path}`,
      `fsync ${dirname(moved)}`,
      `write ${done}`,
      `fsync ${t.dir}`,
    ]);
    expect(outcome.duplicate).toBe('none');
  });
});
