#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The mac helper's protocol v2 for the image-capture client: ready, devices.start with events, a crash.
import { createInterface } from 'node:readline';

const protocol = process.argv.includes('--v1') ? 1 : 2;
write({ type: 'ready', protocol, services: ['devices'], serviceVersions: { devices: 1 } });
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type !== 'request') return;
  if (message.method === 'die') process.exit(2);
  if (message.method === 'devices.start') {
    write({
      type: 'event',
      service: 'devices',
      name: 'device.added',
      data: { handle: 'h1', productKind: 'iPhone' },
    });
    write({ type: 'response', id: message.id, ok: true, result: { ok: true } });
    return;
  }
  const error = { code: 'devices.not_found', message: '/private/secret', retryable: false };
  write({ type: 'response', id: message.id, ok: false, error });
});

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
