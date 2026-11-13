// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The credentials project builds the sidecar only when the crate's inputs changed (build-sidecar.ts): the hash it
// keeps beside the binary follows every input and nothing else.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crateInputHash } from './build-sidecar';

let crate = '';

async function makeCrate(): Promise<string> {
  crate = await mkdtemp(join(tmpdir(), 'c2pa-crate-'));
  await mkdir(join(crate, 'src', 'nested'), { recursive: true });
  await mkdir(join(crate, 'certs'));
  await mkdir(join(crate, 'target', 'release'), { recursive: true });
  await writeFile(join(crate, 'Cargo.toml'), '[package]\nname = "x"\n');
  await writeFile(join(crate, 'Cargo.lock'), 'version = 4\n');
  await writeFile(join(crate, 'src', 'main.rs'), 'fn main() {}\n');
  await writeFile(join(crate, 'src', 'nested', 'mod.rs'), '// mod\n');
  await writeFile(join(crate, 'certs', 'es256.pub'), 'cert');
  return crate;
}

afterEach(async () => {
  if (crate) await rm(crate, { recursive: true, force: true });
});

describe('the sidecar crate’s input hash', () => {
  it('is the same for the same inputs, and ignores the build output', async () => {
    const dir = await makeCrate();
    const first = crateInputHash(dir);
    await writeFile(join(dir, 'target', 'release', 'taalcut-c2pa'), 'binary');
    expect(crateInputHash(dir)).toBe(first);
  });

  it.for([
    ['a source', 'src/nested/mod.rs'],
    ['the lockfile', 'Cargo.lock'],
    ['the embedded certificate', 'certs/es256.pub'],
  ] as const)('changes with %s', async ([, file]) => {
    const dir = await makeCrate();
    const before = crateInputHash(dir);
    await writeFile(join(dir, file), 'changed');
    expect(crateInputHash(dir)).not.toBe(before);
  });

  it('changes with a new source file', async () => {
    const dir = await makeCrate();
    const before = crateInputHash(dir);
    await writeFile(join(dir, 'src', 'extra.rs'), '');
    expect(crateInputHash(dir)).not.toBe(before);
  });
});
