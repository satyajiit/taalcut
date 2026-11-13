// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An Android phone in File transfer mode for the device service: the USB bus the hub and the MTP
 * bridge both watch (a late watcher sees what is already plugged in, like WebUSB's getDevices), a
 * fresh memory responder per open, and camera-roll bodies built in-process (no FFmpeg): JPEGs with
 * a JFIF header and a unique comment, MP4s with an ftyp box and a patterned mdat.
 */
import { createMtpBridge } from '../../../src/bridges/mtp/bridge';
import { createEventQueue, type EventQueue } from '../../../src/usb/event-queue';
import type { TransferMedia } from '../../../src/deps';
import type { UsbDeviceInfo, UsbWatcher } from '../../../src/usb/bridge';
import type { FakePhone } from '../fake-phone';
import {
  bytesBody,
  createMemoryPipe,
  type MemoryObject,
  type MemoryPipe,
  type MemoryPipeOptions,
} from './memory-pipe';

type Plug = { readonly type: 'added' | 'removed'; readonly device: UsbDeviceInfo };

export interface MtpPhone extends FakePhone {
  /** One responder per open: the first is the one the cable comes out of. */
  readonly pipes: readonly MemoryPipe[];
}

export function createUsbBus(): UsbWatcher & {
  plug(device: UsbDeviceInfo): void;
  unplug(device: UsbDeviceInfo): void;
} {
  const present = new Map<string, UsbDeviceInfo>();
  const subscribers = new Set<EventQueue<Plug>>();
  const send = (plug: Plug): void => {
    for (const queue of subscribers) queue.push(plug);
  };
  return {
    plug(device) {
      present.set(device.locationId, device);
      send({ type: 'added', device });
    },
    unplug(device) {
      present.delete(device.locationId);
      send({ type: 'removed', device });
    },
    watch(signal) {
      const queue = createEventQueue<Plug>();
      for (const device of present.values()) queue.push({ type: 'added', device });
      subscribers.add(queue);
      return (async function* () {
        try {
          yield* queue.drain(signal);
        } finally {
          subscribers.delete(queue);
        }
      })();
    },
  };
}

/**
 * `first` applies to the first open only (it carries the cable pull); every later open gets `rest`.
 * The phone answers on the still-image interface (class 6, subclass 1, protocol 1) and has no adb.
 */
export function createMtpPhone(
  device: UsbDeviceInfo,
  objects: readonly MemoryObject[],
  first: MemoryPipeOptions,
  rest: MemoryPipeOptions,
): MtpPhone {
  const bus = createUsbBus();
  const pipes: MemoryPipe[] = [];
  const bridge = createMtpBridge({
    plugs: bus,
    openPipe: async () => {
      const pipe = createMemoryPipe(objects, pipes.length === 0 ? first : rest);
      pipes.push(pipe);
      return pipe;
    },
  });
  return {
    bridge,
    watcher: bus,
    pipes,
    plug: () => bus.plug(device),
    unplug: () => bus.unplug(device),
    pulls: () =>
      pipes.flatMap((pipe) =>
        pipe.reads.filter((read) => read.offset === 0).map((read) => String(read.handle)),
      ),
  };
}

export function jpegBody(seed: number, index: number, size: number): MemoryObject['body'] {
  const comment = new TextEncoder().encode(`taalcut fake camera ${seed} ${index}`);
  const head = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xfe,
    (comment.byteLength + 2) >> 8,
    (comment.byteLength + 2) & 0xff,
  ]);
  const bytes = new Uint8Array(Math.max(size, head.byteLength + comment.byteLength + 2));
  bytes.set(head, 0);
  bytes.set(comment, head.byteLength);
  for (let at = head.byteLength + comment.byteLength; at < bytes.byteLength - 2; at += 1)
    bytes[at] = (at * 13 + index + seed) & 0x7f;
  bytes[bytes.byteLength - 2] = 0xff;
  bytes[bytes.byteLength - 1] = 0xd9;
  return bytesBody(bytes);
}

export function mp4Body(seed: number, index: number, size: number): MemoryObject['body'] {
  const ftyp = Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69,
    0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  ]);
  const bytes = new Uint8Array(size);
  bytes.set(ftyp, 0);
  const mdat = size - ftyp.byteLength;
  new DataView(bytes.buffer).setUint32(ftyp.byteLength, mdat, false);
  bytes.set([0x6d, 0x64, 0x61, 0x74], ftyp.byteLength + 4);
  for (let at = ftyp.byteLength + 8; at < size; at += 1) bytes[at] = (at * 7 + index * 3 + seed) & 0xff;
  return bytesBody(bytes);
}

/**
 * No FFmpeg here: the probe answers "could not read", so verify leans on the size, the sniffed
 * kind and the hashes (the 1,000-item iPhone proof runs the real probe).
 */
export function noProbe(): TransferMedia {
  return {
    async probe() {
      return { ok: false as const };
    },
  };
}
