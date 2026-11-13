#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The mac helper's ASR service, faked (protocol v2): `asr.load` loads nothing and answers with the helper's
// arguments, `asr.transcribe` answers one word and echoes the path it was asked for.
import { createInterface } from 'node:readline';

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
write({ type: 'ready', protocol: 2, services: ['asr'], serviceVersions: { asr: 1 }, pid: process.pid });

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type !== 'request') return;
  const { id, method, params } = message;
  if (method === 'asr.load') {
    write({ type: 'response', id, ok: true, result: { loadMs: 1, argv: process.argv.slice(2) } });
    return;
  }
  if (method === 'asr.transcribe') {
    const words = [{ text: 'Hola', startMs: 100, endMs: 400, confidence: 0.9 }];
    write({
      type: 'response',
      id,
      ok: true,
      result: { text: params.path, durationMs: 1000, rtf: 0.01, words },
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
