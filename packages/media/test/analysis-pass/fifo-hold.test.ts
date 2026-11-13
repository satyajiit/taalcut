// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-F4: the helper opens the pass's FIFO for writing without blocking, which fails (ENXIO) while no reader has it
 * open. Held, it opens at once, whenever the reader FFmpeg starts; released, it is as before.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, constants, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdFifo } from '../../src/analysis-pass/fifo-hold';

let dir: string;
let fifo: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'taalcut-fifo-hold-'));
  fifo = join(dir, 'pass.nv12');
  execFileSync('/usr/bin/mkfifo', ['-m', '600', fifo]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** What the helper does (RawSink.swift): a write end, without blocking. */
const openAsHelper = () => openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);

describe.skipIf(process.platform === 'win32')('holding the pass FIFO open', () => {
  it('lets the helper open it before any reader, then lets go', async () => {
    expect(openAsHelper).toThrow(/ENXIO/);
    const held = unwrap(await holdFifo(fifo));
    const writer = openAsHelper();
    // The bytes wait in the pipe for whichever reader comes.
    expect(writeSync(writer, Buffer.alloc(4096, 1))).toBe(4096);
    closeSync(writer);
    await held.release();
    await held.release();
    expect(openAsHelper).toThrow(/ENXIO/);
  });

  it('says why when there is no FIFO to hold', async () => {
    const missing = await holdFifo(join(dir, 'gone.nv12'));
    expect(!missing.ok && missing.error.code).toBe('media.sidecar_failed');
  });
});
