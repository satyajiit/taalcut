// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createPrivateKey } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { connectRpc, deviceKeysContract, serveRpc } from '@taalcut/core';
import { createMemorySecretStore } from '@taalcut/models';
import { deviceKeysRouter } from '../src/main/transfer/device-keys';

const ports: MessageChannel[] = [];
afterEach(() => {
  for (const { port1, port2 } of ports.splice(0)) {
    port1.close();
    port2.close();
  }
});

function client() {
  const channel = new MessageChannel();
  ports.push(channel);
  serveRpc(deviceKeysRouter(createMemorySecretStore()), channel.port1, { context: {} });
  return connectRpc(deviceKeysContract, channel.port2, { peer: 'main' }).client;
}

describe('adb device key', () => {
  it('returns the same RSA-2048 PKCS#8 key twice, then forgets it once', async () => {
    const keys = client();
    const first = await keys.adbKey();
    const second = await keys.adbKey();
    expect(first.pkcs8).toBe(second.pkcs8);
    const parsed = createPrivateKey({
      key: Buffer.from(first.pkcs8, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    expect(parsed.asymmetricKeyType).toBe('rsa');
    expect(parsed.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(await keys.forgetAdbKey()).toEqual({ forgotten: true });
    expect(await keys.forgetAdbKey()).toEqual({ forgotten: false });
  });
});
