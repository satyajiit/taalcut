// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chmod, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TRANSFER_LIMITS } from '../../src/limits';
import { httpCall, manualClock, startFixture, type Fixture } from '../support/harness';
import { pairPhone, tokenOf } from '../support/upload';

describe('pairing', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('pairs with the QR token and the PIN, and stores only the credential hash', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    expect(fx.pairing.qrText).toBe(`${fx.base()}/#k=${token}`);
    expect(fx.pairing.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(fx.pairing.pin).toMatch(/^\d{6}$/);
    const paired = await pairPhone(fx, { token, pin: fx.pairing.pin });
    expect(paired.status).toBe(200);
    expect(paired.credential.length).toBeGreaterThan(20);
    const stored = await readFile(join(fx.stateDir, 'devices.json'), 'utf8');
    expect(stored).not.toContain(paired.credential);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(fx.pairing.pin);
    expect(stored).toMatch(/"hash":"[a-f0-9]{64}"/);
    const mode = (await stat(join(fx.stateDir, 'devices.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
    const sessionEvents = fx.events
      .filter((event) => event.type === 'transfer.session')
      .map((event) => JSON.stringify(event.payload));
    expect(sessionEvents.join('\n')).not.toContain(token);
    expect(sessionEvents.join('\n')).not.toContain(fx.pairing.pin);
    expect(fx.logs.join('\n')).not.toContain(token);
    await chmod(join(fx.stateDir, 'devices.json'), 0o600);
  });

  it('pairs with the setup code and the PIN', async () => {
    fx = await startFixture();
    const paired = await pairPhone(fx, { code: fx.pairing.code, pin: fx.pairing.pin });
    expect(paired.status).toBe(200);
    expect(paired.deviceId.length).toBeGreaterThan(0);
  });

  it('refuses a token or a PIN on its own', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    const pinOnly = await pairPhone(fx, { pin: fx.pairing.pin });
    clock.set(clock.now() + 1_100);
    const tokenOnly = await httpCall({
      host: fx.address,
      port: fx.port,
      method: 'POST',
      path: '/api/pair',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, device: {} }),
    });
    expect(pinOnly.status).toBe(401);
    expect(tokenOnly.status).toBe(401);
    expect(pinOnly.body).toBe('');
  });

  it('rejects a wrong PIN and rotates the QR after five failures', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const first = fx.pairing.pin;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      clock.set(clock.now() + 1_100);
      const refused = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: '000000' });
      expect(refused.status).toBe(401);
    }
    const rotated = await fx.waitFor(
      (item) => item.type === 'session' && item.pairing !== undefined && item.pairing.pin !== first,
    );
    expect(rotated.type === 'session' && rotated.session.pairingResets).toBe(1);
    expect(fx.logs.join('\n')).not.toContain('000000');
    expect(fx.logs.some((line) => line.startsWith('pair reset'))).toBe(true);
  });

  it('allows one pairing attempt a second per address', async () => {
    fx = await startFixture({ clock: manualClock() });
    const first = await pairPhone(fx, { token: 'wrong-token', pin: '111111' });
    const second = await httpCall({
      host: fx.address,
      port: fx.port,
      method: 'POST',
      path: '/api/pair',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token', pin: '111111', device: {} }),
    });
    expect(first.status).toBe(401);
    expect(second.status).toBe(429);
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('expires a credential after a day and forgets every phone', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const paired = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin });
    clock.set(clock.now() + TRANSFER_LIMITS.credentialTtlMs + 1_000);
    const expired = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/session',
      headers: { authorization: `Bearer ${paired.credential}` },
    });
    expect(expired.status).toBe(401);
    clock.set(clock.now() + 1_100);
    const again = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin });
    expect(again.status).toBe(200);
    const forgotten = await fx.service.forgetDevices();
    expect(forgotten.forgotten).toBe(1);
    const revoked = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/session',
      headers: { authorization: `Bearer ${again.credential}` },
    });
    expect(revoked.status).toBe(401);
  });
});
