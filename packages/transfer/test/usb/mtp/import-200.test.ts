// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B5, "200 selected items with no app on the phone": fake Pixel, Samsung and budget phones in
 * File transfer mode go through the real device service (hub, selection, run engine, item
 * pipeline, verify, ledger) into a copy sink over a temp originals root. Each phone answers MTP its
 * own way, and each loses its cable part-way through a video and carries on from the part.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssetId, DeviceRun } from '@taalcut/core';
import {
  CHUNK_BYTES,
  OP_GET_OBJECT_PROP_LIST,
  OP_GET_PARTIAL_OBJECT,
  OP_GET_PARTIAL_OBJECT_64,
  OP_OPEN_SESSION,
} from '../../../src/bridges/mtp/codes';
import type { DeviceService, UsbDeviceInfo } from '../../../src/usb/bridge';
import { itemKey } from '../../../src/usb/device-key';
import { createCopySink, createHarness, connectPhone, untilTerminal } from '../import-harness';
import {
  folder,
  patternBody,
  type MemoryObject,
  type MemoryPipe,
  type MemoryPipeOptions,
} from './memory-pipe';
import { createMtpPhone, jpegBody, mp4Body, noProbe, type MtpPhone } from './mtp-phone';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const CUT_HANDLE = 305;
const EXCLUDED = 150;

interface Profile {
  readonly name: string;
  readonly device: UsbDeviceInfo;
  readonly pipe: MemoryPipeOptions;
  readonly check: (pipes: readonly MemoryPipe[]) => void;
}

const PROFILES: readonly Profile[] = [
  {
    // GetPartialObject64, and ObjectSize only through GetObjectPropList (for its 5 GiB clip).
    name: 'Pixel',
    device: usb('pixel', 0x18d1, 'PIXEL-FAKE', 'Pixel 8'),
    pipe: { propValue: false, propList: true },
    check(pipes) {
      expect(pipes[0]?.opcodes).toContain(OP_GET_OBJECT_PROP_LIST);
      for (const pipe of pipes) expect(pipe.opcodes).not.toContain(OP_GET_PARTIAL_OBJECT);
    },
  },
  {
    // Answers OpenSession with SessionAlreadyOpen, and bulk-in transfers of at most 16 KiB.
    name: 'Samsung',
    device: usb('samsung', 0x04e8, 'SAMSUNG-FAKE', 'Galaxy S24'),
    pipe: { sessionAlreadyOpen: true, maxTransfer: 16 * 1024 },
    check(pipes) {
      for (const pipe of pipes) {
        expect(pipe.opcodes[0]).toBe(OP_OPEN_SESSION);
        expect(pipe.transactions[0]).toBe(0);
        expect(pipe.opcodes).not.toContain(OP_GET_PARTIAL_OBJECT);
      }
    },
  },
  {
    // No GetPartialObject64 (refused once per session, then GetPartialObject), 4 KiB transfers.
    name: 'budget phone',
    device: usb('budget', 0x2717, 'REDMI-FAKE', 'Redmi 13C'),
    pipe: { partial64Unsupported: true, maxTransfer: 4096 },
    check(pipes) {
      for (const pipe of pipes) {
        expect(pipe.opcodes.filter((code) => code === OP_GET_PARTIAL_OBJECT_64)).toHaveLength(1);
        expect(pipe.opcodes.filter((code) => code === OP_GET_PARTIAL_OBJECT).length).toBeGreaterThan(0);
      }
    },
  },
];

const dirs: string[] = [];

// The service has no awaitable teardown: once the streams abort, the hub closes sessions and clears
// thumbnails in the background, so removal retries while those last writes land.
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

describe('MTP import of 200 selected items', () => {
  it.each(PROFILES)(
    'imports 200 from the $name, survives a cable pull, then Only new finds none',
    async (profile) => {
      const root = await mkdtemp(join(tmpdir(), 'mtp-200-'));
      dirs.push(root);
      const staging = join(root, 'staging');
      const originals = join(root, 'originals');
      const state = join(root, 'state');
      await Promise.all([mkdir(staging), mkdir(originals), mkdir(state)]);
      const { objects, expected } = catalogue(profile.device.vendorId, profile.name === 'Pixel');
      const holder: { phone: MtpPhone | null } = { phone: null };
      const cut = { handle: CUT_HANDLE, offset: 2 * CHUNK_BYTES, onGone: () => holder.phone?.unplug() };
      const phone = createMtpPhone(
        profile.device,
        objects,
        { ...profile.pipe, disconnectAt: cut },
        profile.pipe,
      );
      holder.phone = phone;
      const known = new Set<AssetId>();
      const copy = createCopySink(staging, originals, known);
      const service = createHarness(state, copy.sink, noProbe(), phone);
      const life = new AbortController();
      try {
        const key = await connectPhone(service, phone, life.signal);
        const opened = await service.openDevice(key, life.signal);
        expect(opened.ok).toBe(true);
        const selection = {
          filter: { from: '2024-06-01', to: '2024-06-30', albums: ['Camera'], onlyNew: true, timeZone: ZONE },
          include: [],
          exclude: [itemKey(String(EXCLUDED))],
        };
        const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const replugged = replugOnPause(service, phone, started.value.runId, life.signal);
        const finished = await untilTerminal(service, started.value.runId, life.signal);
        expect(await replugged).toBe(true);
        expect(finished.state).toBe('succeeded');
        expect(finished.totals).toMatchObject({ items: 200, imported: 200, failed: 0 });
        expect(copy.imports()).toBe(200);

        const names = (await readdir(originals)).sort();
        expect(names).toEqual([...expected.keys()].sort());
        for (const [name, bytes] of expected) {
          const onDisk = await readFile(join(originals, name));
          expect(sha256(onDisk), name).toBe(sha256(bytes));
        }

        expect(phone.pipes).toHaveLength(2);
        const [first, second] = phone.pipes;
        expect(first?.reads.filter((read) => read.handle === CUT_HANDLE).map((read) => read.offset)).toEqual([
          0,
          CHUNK_BYTES,
          2 * CHUNK_BYTES,
        ]);
        expect(second?.reads.find((read) => read.handle === CUT_HANDLE)?.offset).toBe(2 * CHUNK_BYTES);
        profile.check(phone.pipes);

        const again = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
        expect(again.ok).toBe(true);
        if (!again.ok) return;
        const rerun = await untilTerminal(service, again.value.runId, life.signal);
        expect(rerun.state).toBe('succeeded');
        expect(rerun.totals).toMatchObject({ items: 0, imported: 0 });
        expect(copy.imports()).toBe(200);
      } finally {
        life.abort();
      }
    },
    120_000,
  );
});

/** Plugs the phone back in once the run has paused because the cable came out. */
async function replugOnPause(
  service: DeviceService,
  phone: MtpPhone,
  runId: DeviceRun['id'],
  signal: AbortSignal,
): Promise<boolean> {
  for await (const view of service.deviceRun(runId, signal)) {
    if (view.state !== 'paused' || view.pauseReason !== 'device-gone') continue;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    phone.plug();
    return true;
  }
  return false;
}

/**
 * DCIM/Camera holds 191 June JPEGs and 10 June MP4s (three 1 MiB chunks each); one JPEG is
 * excluded by id, so 200 are selected. Older Camera shots, the June screenshots, Download and
 * Movies (with a 5 GiB clip on the Pixel) are listed or walked but not selected.
 */
function catalogue(seed: number, withHugeClip: boolean) {
  const objects: MemoryObject[] = [
    folder(1, 0, 'DCIM'),
    folder(2, 1, 'Camera'),
    folder(3, 0, 'Download'),
    folder(4, 0, 'Movies'),
    folder(5, 0, 'Pictures'),
    folder(6, 5, 'Screenshots'),
  ];
  const expected = new Map<string, Uint8Array>();
  const add = (object: MemoryObject, selected: boolean): void => {
    objects.push(object);
    if (selected) expected.set(object.name, object.body.read(0, object.body.size));
  };
  for (let index = 0; index < 191; index += 1) {
    const handle = 100 + index;
    const body = jpegBody(seed, index, 2048 + (index % 50) * 700);
    add(file(handle, 2, `IMG_${handle}.jpg`, 0x3801, body, june(index)), handle !== EXCLUDED);
  }
  for (let index = 0; index < 10; index += 1) {
    const handle = 300 + index;
    const body = mp4Body(seed, index, 2 * CHUNK_BYTES + 500_000 + index * 1000);
    add(file(handle, 2, `VID_${handle}.mp4`, 0xb982, body, june(index * 3 + 1)), true);
  }
  for (let index = 0; index < 3; index += 1)
    add(
      file(400 + index, 2, `OLD_${index}.jpg`, 0x3801, jpegBody(seed, 400 + index, 3000), '20230101T090000'),
      false,
    );
  add(file(600, 6, 'Screenshot_1.jpg', 0x3801, jpegBody(seed, 600, 4000), june(5)), false);
  add(file(601, 6, 'Screenshot_2.jpg', 0x3801, jpegBody(seed, 601, 4000), june(6)), false);
  add(file(500, 3, 'download.jpg', 0x3801, jpegBody(seed, 500, 3000), june(7)), false);
  add(file(501, 4, 'old.mp4', 0xb982, mp4Body(seed, 501, 9000), '20230301T100000'), false);
  if (withHugeClip)
    add(file(502, 4, 'long-take.mov', 0x300d, patternBody(5 * 2 ** 30, seed), '20230401T100000'), false);
  return { objects, expected };
}

function file(
  handle: number,
  parent: number,
  name: string,
  format: number,
  body: MemoryObject['body'],
  created: string,
): MemoryObject {
  return {
    handle,
    storageId: 1,
    parent,
    format,
    name,
    created,
    modified: created,
    body,
    width: 0,
    height: 0,
  };
}

/** Local phone time on a June 2024 day, never near midnight. */
function june(index: number): string {
  const day = String(1 + (index % 30)).padStart(2, '0');
  const hour = String(8 + (index % 12)).padStart(2, '0');
  const minute = String(index % 60).padStart(2, '0');
  return `202406${day}T${hour}${minute}00`;
}

function usb(locationId: string, vendorId: number, serial: string, product: string): UsbDeviceInfo {
  return {
    locationId,
    vendorId,
    productId: 0x4ee1,
    serial,
    product,
    interfaces: [{ cls: 6, sub: 1, proto: 1 }],
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
