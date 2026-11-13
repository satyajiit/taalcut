// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C2PA_UUID, hasC2paManifestBox, topLevelBoxes } from '../../src/credentials/c2pa-box';

const box = (type: string, body: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
};
const largeBox = (type: string, body: Buffer) => {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, 'latin1');
  header.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([header, body]);
};
const uuidBox = (uuid: Buffer) => box('uuid', Buffer.concat([uuid, Buffer.from('manifest store bytes')]));

let dir = '';
const file = async (name: string, ...parts: Buffer[]) => {
  const path = join(dir, name);
  await writeFile(path, Buffer.concat(parts));
  return path;
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-c2pa-box-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('hasC2paManifestBox', () => {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1'));
  const moov = box('moov', Buffer.alloc(64));
  const mdat = box('mdat', Buffer.alloc(256));

  it('finds the C2PA uuid box after ftyp', async () => {
    expect(await hasC2paManifestBox(await file('signed.mp4', ftyp, uuidBox(C2PA_UUID), moov, mdat))).toBe(
      true,
    );
  });

  it('ignores a uuid box of another kind and a plain file', async () => {
    const other = Buffer.from('be7acfcb97a942e89c71999491e3afac', 'hex');
    expect(await hasC2paManifestBox(await file('xmp.mp4', ftyp, uuidBox(other), moov, mdat))).toBe(false);
    expect(await hasC2paManifestBox(await file('plain.mp4', ftyp, moov, mdat))).toBe(false);
  });

  it('walks 64-bit sizes and a last box that runs to the end of the file', async () => {
    const toEnd = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('mdat', 'latin1'), Buffer.alloc(32)]);
    const path = await file('large.mp4', ftyp, largeBox('free', Buffer.alloc(40)), uuidBox(C2PA_UUID), toEnd);
    expect((await topLevelBoxes(path)).map((entry) => entry.type)).toEqual(['ftyp', 'free', 'uuid', 'mdat']);
    expect(await hasC2paManifestBox(path)).toBe(true);
  });

  it('stops at a malformed header instead of reading past the file', async () => {
    const broken = Buffer.alloc(8);
    broken.writeUInt32BE(4, 0);
    broken.write('moov', 4, 'latin1');
    const path = await file('broken.mp4', ftyp, broken, uuidBox(C2PA_UUID));
    expect((await topLevelBoxes(path)).map((entry) => entry.type)).toEqual(['ftyp']);
    expect(await hasC2paManifestBox(path)).toBe(false);
  });
});
