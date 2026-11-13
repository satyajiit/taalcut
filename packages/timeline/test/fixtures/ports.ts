// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A MessagePortMain stand-in (as core's tests use) so routers can be served and called in one process. */
import { EventEmitter } from 'node:events';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach } from 'vitest';

const open: MessagePort[] = [];

afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

class FakeMessagePortMain extends EventEmitter {
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
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  return { port1: new FakeMessagePortMain(port1), port2: new FakeMessagePortMain(port2) };
}
