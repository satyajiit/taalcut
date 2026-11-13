#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * `--mark <file>`: notes `eof` and `sigterm` there; `--linger <ms>`: exits that long after stdin ends; `--stuck`:
 * never exits on its own, and survives SIGTERM (a helper stuck the way a VideoToolbox session was).
 */
const argument = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const mark = argument('--mark');
const linger = Number(argument('--linger') ?? 0);
const stuck = process.argv.includes('--stuck');
const note = (what) => {
  if (mark) appendFileSync(mark, `${what}\n`);
};
process.on('SIGTERM', () => {
  note('sigterm');
  if (!stuck) process.exit(143);
});
if (stuck) setInterval(() => {}, 1000);
/** Requests that answer a cancel only after a while, as a decode invalidating its session does. */
const slow = new Set();

process.stdout.write(`${JSON.stringify({ type: 'ready', protocol: 1, pid: process.pid, argv: process.argv.slice(1) })}\n`);

let held;
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type === 'cancel' && slow.has(message.id)) {
    slow.delete(message.id);
    setTimeout(() => write(message.id, false, { code: 'helper.cancelled', message: 'cancelled' }), 150);
    return;
  }
  if (message.type !== 'request') return;
  const id = message.id;
  if (message.method === 'hang') return;
  if (message.method === 'mute') return;
  if (message.method === 'slow') {
    slow.add(id);
    return;
  }
  if (message.method === 'boom') {
    process.exit(1);
  }
  if (message.method === 'retry') {
    write(id, false, { code: 'ocr.failed', message: 'again', retryable: true });
    return;
  }
  if (message.method === 'ocr.languages') {
    write(id, true, { accurate: ['en', 'es', 'pt'] });
    return;
  }
  if (message.method === 'beat') {
    // A keepalive every `every` ms for `for` ms, then the answer (OCR v2, FIX-OCRCOLD); `quiet`: no answer at all.
    const { every = 20, for: span = 200, quiet = false } = message.params ?? {};
    const timer = setInterval(() => {
      process.stdout.write(`${JSON.stringify({ type: 'progress', id, fraction: 0, stage: 'running' })}\n`);
    }, every);
    setTimeout(() => {
      clearInterval(timer);
      if (!quiet) write(id, true, { beats: true });
    }, span);
    return;
  }
  if (message.method === 'progress') {
    process.stdout.write(`${JSON.stringify({ type: 'progress', id, fraction: 0.5 })}\n`);
    write(id, true, { text: 'done' });
    return;
  }
  if (message.method === 'hold') {
    held = id;
    return;
  }
  if (message.method === 'release') {
    write(id, true, { released: true });
    if (held !== undefined) write(held, true, { held: true });
    held = undefined;
    return;
  }
  if (message.method === 'huge') {
    process.stdout.write(`${'x'.repeat(2048)}\n`);
    return;
  }
  if (message.method === 'image.properties') {
    if (message.params?.path === 'missing') {
      write(id, false, { code: 'image.unreadable', message: 'no', retryable: false });
      return;
    }
    write(id, true, {
      width: 640,
      height: 360,
      orientation: 6,
      hasGainMap: false,
      captureTime: '2026:03:01 12:34:56',
      contentIdentifier: 'LIVE',
      gps: { latitude: 19.076, longitude: 72.877 },
    });
    return;
  }
  write(id, false, { code: 'helper.unknown_method', message: String(message.method), retryable: false });
});

lines.on('close', () => {
  note('eof');
  if (!stuck) setTimeout(() => process.exit(0), linger);
});

function write(id, ok, body) {
  const message = ok
    ? { type: 'response', id, ok: true, result: body }
    : { type: 'response', id, ok: false, error: body };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
