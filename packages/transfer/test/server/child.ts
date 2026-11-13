// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Server child for the killed-process resume test. One JSON line on stdout
 * (port, token, pin, code) is for the test harness. The service log stays on
 * stderr and must not repeat those secrets.
 *
 *   node --import tsx test/server/child.ts <stateDir> <stagingDir>
 */
import { writeSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { newId } from '@taalcut/core';
import { createTransferService } from '../../src/index';

const stateDir = process.argv[2];
const stagingDir = process.argv[3];
if (!stateDir || !stagingDir) {
  process.stderr.write('usage: child <stateDir> <stagingDir>\n');
  process.exit(1);
}

const service = createTransferService({
  importSink: {
    async staging() {
      await mkdir(stagingDir, { recursive: true });
      return { ok: true, value: { dir: stagingDir, freeBytes: 1 << 40, volumeName: 'Test' } };
    },
    async importStaged() {
      return {
        ok: true,
        value: { assetId: newId<'Asset'>(), sourceId: newId<'Source'>(), duplicate: 'none' as const },
      };
    },
  },
  media: { probe: async () => ({ ok: false as const }) },
  events: { emit() {} },
  clock: { now: () => Date.now() },
  stateDir,
  phoneAssets: {},
  network: {
    candidates: () => [{ name: 'lo0', address: '127.0.0.1' }],
    watch: () => () => undefined,
  },
  log: { info: (line) => process.stderr.write(`${line}\n`) },
  selfTest: async () => 'yes',
  allowLoopback: true,
});

const controller = new AbortController();
for await (const item of service.open({}, controller.signal)) {
  if (item.type !== 'session' || item.session.state !== 'listening' || !item.pairing || !item.session.url)
    continue;
  const url = new URL(item.session.url);
  const token = new URL(item.pairing.qrText).hash.replace(/^#k=/, '');
  writeSync(
    1,
    `${JSON.stringify({ port: Number(url.port), token, pin: item.pairing.pin, code: item.pairing.code })}\n`,
  );
}
