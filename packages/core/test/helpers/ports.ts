// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test ports. Node's worker_threads MessageChannel stands in for the DOM
 * MessageChannel (addEventListener). FakeMessagePortMain behaves like
 * Electron's MessagePortMain: an EventEmitter whose 'message' listeners get
 * `{ data, ports }`, and which queues messages until start() is called.
 */
import { EventEmitter } from 'node:events';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach } from 'vitest';

const open: MessagePort[] = [];

afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

export function channel(): { port1: MessagePort; port2: MessagePort } {
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  return { port1, port2 };
}

export class FakeMessagePortMain extends EventEmitter {
  private started = false;

  constructor(private readonly inner: MessagePort) {
    super();
    inner.on('close', () => this.emit('close'));
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.inner.on('message', (data: unknown) => this.emit('message', { data, ports: [] }));
  }

  postMessage(message: unknown): void {
    this.inner.postMessage(message);
  }

  close(): void {
    this.inner.close();
  }
}

export function mainChannel(): { port1: FakeMessagePortMain; port2: FakeMessagePortMain } {
  const { port1, port2 } = channel();
  return { port1: new FakeMessagePortMain(port1), port2: new FakeMessagePortMain(port2) };
}

export const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
