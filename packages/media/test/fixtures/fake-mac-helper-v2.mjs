#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Protocol v2 stand-in: ready with services, `event` lines, a crash, a silent start, a closed stdin.
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
if (!args.includes('--silent')) {
  const protocol = args.includes('--v1') ? 1 : 2;
  const services = args.includes('--no-devices') ? ['ocr'] : ['devices'];
  write({ type: 'ready', protocol, services, serviceVersions: { devices: 1 }, pid: process.pid });
}

// --stay: keep running after stdin ends (a test closes stdin before this script starts).
if (args.includes('--stay')) setInterval(() => undefined, 1000);

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type !== 'request') return;
  const { id, method } = message;
  if (method === 'hang') return;
  if (method === 'devices.start') {
    write({
      type: 'event',
      service: 'devices',
      name: 'device.added',
      data: { handle: 'h1', label: 'Phone' },
    });
    write({ type: 'event', name: 'device.catalog', data: { handle: 'h1', percent: 100 } });
    write({ type: 'event', service: 'devices' });
    write({ type: 'response', id, ok: true, result: { ok: true } });
    return;
  }
  if (method === 'pid') {
    write({ type: 'response', id, ok: true, result: { pid: process.pid } });
    return;
  }
  if (method === 'die') process.exit(3);
  if (method === 'failing') {
    write({
      type: 'response',
      id,
      ok: false,
      error: { code: 'devices.item_empty', message: 'x', retryable: false },
    });
    return;
  }
  write({
    type: 'response',
    id,
    ok: false,
    error: { code: 'helper.unknown_method', message: method, retryable: false },
  });
});

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
