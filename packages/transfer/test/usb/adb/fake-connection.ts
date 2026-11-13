// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An adb daemon connection that answers nothing on its own: the test feeds
 * it AUTH packets and closes it, the way a phone with the Allow prompt up,
 * or one that is unplugged, would. Only commands are recorded.
 */
import { AdbAuthType, type AdbDaemonConnection, type AdbPacketData } from '@yume-chan/adb';
// pnpm does not hoist this transitive dependency. AdbDaemonConnection is typed with these classes.
import {
  ReadableStream,
  WritableStream,
  type Consumable,
} from '../../../../../node_modules/.pnpm/@yume-chan+stream-extra@2.6.1/node_modules/@yume-chan/stream-extra';

const AUTH = 0x48545541;

export interface FakeConnection {
  readonly connection: AdbDaemonConnection;
  /** Commands the host sent, as numbers (CNXN, AUTH). */
  readonly sent: readonly number[];
  /** The phone asks for a signature (one AUTH TOKEN). */
  token(): void;
  /** The cable comes out. */
  unplug(): void;
}

export function createFakeConnection(): FakeConnection {
  const sent: number[] = [];
  const held: { controller?: ReadableStreamDefaultController<AdbPacketData> } = {};
  const readable = new ReadableStream<AdbPacketData>({
    start(controller) {
      held.controller = controller;
    },
  });
  const controller = held.controller;
  if (!controller) throw new Error('adb-connection');
  const writable = new WritableStream<Consumable<{ readonly command: number }>>({
    write(chunk) {
      chunk.tryConsume((packet) => {
        sent.push(packet.command);
      });
    },
  });
  return {
    connection: { readable, writable },
    sent,
    token() {
      controller.enqueue({
        command: AUTH,
        arg0: AdbAuthType.Token,
        arg1: 0,
        payload: new Uint8Array(20).fill(7),
      });
    },
    unplug() {
      controller.close();
    },
  };
}
