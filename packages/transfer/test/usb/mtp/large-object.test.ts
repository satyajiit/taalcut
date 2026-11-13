// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A 5 GiB object: ObjectInfo says 0xFFFFFFFF, the real size comes from ObjectSize, a ranged read
 * past 4 GiB asks GetPartialObject64 with a high word, and a phone without that operation, or one
 * that won't tell the size, refuses the object instead of handing back a truncated original.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMtpBridge } from '../../../src/bridges/mtp/bridge';
import {
  CHUNK_BYTES,
  OP_GET_OBJECT_PROP_LIST,
  OP_GET_PARTIAL_OBJECT_64,
} from '../../../src/bridges/mtp/codes';
import { createMtpSession } from '../../../src/bridges/mtp/session';
import type { BridgeDeviceRef, DeviceItem } from '../../../src/usb/bridge';
import {
  createMemoryPipe,
  folder,
  patternBody,
  patternByte,
  type MemoryObject,
  type MemoryPipeOptions,
} from './memory-pipe';

const SIZE = 5 * 2 ** 30 + 123;
const SEED = 41;
const REF: BridgeDeviceRef = {
  bridge: 'mtp',
  handle: 'loc',
  identity: 'serial',
  label: 'Pixel',
  platform: 'android',
};
const signal = new AbortController().signal;
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const objects: MemoryObject[] = [
  folder(1, 0, 'DCIM'),
  {
    handle: 2,
    storageId: 1,
    parent: 1,
    format: 0x300d,
    name: 'long-take.mov',
    created: '20240601T120000',
    modified: '20240601T120000',
    body: patternBody(SIZE, SEED),
    width: 3840,
    height: 2160,
  },
];

describe('MTP objects of 4 GiB and more', () => {
  it('lists the true size from GetObjectPropValue', async () => {
    const [item] = await list({});
    expect(item?.sizeBytes).toBe(SIZE);
  });

  it('falls back to GetObjectPropList when the property value is refused', async () => {
    const pipe = createMemoryPipe(objects, { propValue: false, propList: true });
    const [item] = await list({}, pipe);
    expect(item?.sizeBytes).toBe(SIZE);
    expect(pipe.opcodes).toContain(OP_GET_OBJECT_PROP_LIST);
  });

  it('refuses to pull an object whose size the phone will not tell', async () => {
    const pipe = createMemoryPipe(objects, { propValue: false, propList: false });
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'mtp-big-'));
    dirs.push(dir);
    const pulled = await opened.value.pull('2', { dest: join(dir, 'big.part'), offset: 0, signal });
    expect(pulled.ok).toBe(false);
    if (!pulled.ok) expect(pulled.error.detail).toBe('object_size_unknown');
    expect(pipe.reads).toEqual([]);
    await opened.value.close();
  });

  it('reads a range past 4 GiB with the high word set', async () => {
    const pipe = createMemoryPipe(objects);
    const session = createMtpSession(pipe);
    expect((await session.open(signal)).ok).toBe(true);
    const offset = 2 ** 32 + 5000;
    const read = await session.readAt(2, offset, 4096, SIZE, signal);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.byteLength).toBe(4096);
    expect(read.value[0]).toBe(patternByte(SEED, offset));
    expect(read.value[4095]).toBe(patternByte(SEED, offset + 4095));
    expect(pipe.reads).toEqual([{ handle: 2, offset }]);
    expect(pipe.opcodes).toContain(OP_GET_PARTIAL_OBJECT_64);
    await session.close();
  });

  it('continues a part that stops past 4 GiB through to the end', async () => {
    const pipe = createMemoryPipe(objects);
    const session = createMtpSession(pipe);
    expect((await session.open(signal)).ok).toBe(true);
    let position = SIZE - 2 * CHUNK_BYTES - 10;
    const tail: number[] = [];
    while (position < SIZE) {
      const read = await session.readAt(2, position, Math.min(CHUNK_BYTES, SIZE - position), SIZE, signal);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      tail.push(read.value.byteLength);
      expect(read.value[read.value.byteLength - 1]).toBe(
        patternByte(SEED, position + read.value.byteLength - 1),
      );
      position += read.value.byteLength;
    }
    expect(tail).toEqual([CHUNK_BYTES, CHUNK_BYTES, 10]);
    await session.close();
  });

  it('refuses the object on a phone without GetPartialObject64 instead of reading a truncated copy', async () => {
    const pipe = createMemoryPipe(objects, { partial64Unsupported: true });
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'mtp-big32-'));
    dirs.push(dir);
    const dest = join(dir, 'big.part');
    const pulled = await opened.value.pull('2', { dest, offset: 0, signal });
    expect(pulled.ok).toBe(false);
    if (!pulled.ok) expect(pulled.error.detail).toBe('partial64_unsupported');
    expect((await readFile(dest)).byteLength).toBe(0);
    await opened.value.close();
  });
});

async function list(
  options: MemoryPipeOptions,
  pipe = createMemoryPipe(objects, options),
): Promise<DeviceItem[]> {
  const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
  if (!opened.ok) throw new Error(opened.error.code);
  const items: DeviceItem[] = [];
  for await (const page of opened.value.list(signal)) items.push(...page);
  await opened.value.close();
  return items;
}
