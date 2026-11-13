// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Only "no such file" reads as absent; a path that can't be looked at throws rather than passing as missing. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exists, isFile } from '../../src/files/file-presence';
import { tempDir } from '../helpers';

describe('file presence', () => {
  it('tells a file, a folder and nothing apart', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'file'), 'x');
    expect(await exists(join(dir, 'file'))).toBe(true);
    expect(await isFile(join(dir, 'file'))).toBe(true);
    expect(await exists(dir)).toBe(true);
    expect(await isFile(dir)).toBe(false);
    expect(await exists(join(dir, 'gone'))).toBe(false);
    expect(await isFile(join(dir, 'gone'))).toBe(false);
  });

  it('throws when the path itself is wrong rather than calling it missing', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'file'), 'x');
    await expect(exists(join(dir, 'file', 'below'))).rejects.toThrow(/ENOTDIR/);
    await expect(isFile(join(dir, 'file', 'below'))).rejects.toThrow(/ENOTDIR/);
  });
});
