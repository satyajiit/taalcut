// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { err, ok } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import type { ManifestCheck } from '../src/main/update/manifest-check';
import { UpdateManifestUntrusted } from '../src/main/update/manifest-errors';
import { createManifestGate } from '../src/main/update/manifest-gate';
import type { SignedOffer } from '../src/main/update/manifest-yml';
import { startUpdates, type UpdateEvent } from '../src/main/update/updater';
import { fakeSnapshot, FakeNative, FakeUpdater, GOOD } from './helpers/update-fakes';

const SHA = `${'A'.repeat(86)}==`;
const SHA_HEX = Buffer.from(SHA, 'base64').toString('hex');
const OFFER: SignedOffer = { channel: 'beta', version: '0.0.2', sha512: SHA };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The update library that offers what the feed's channel file says when it is asked (then settles as the fake does). */
class OfferingUpdater extends FakeUpdater {
  offer: { version: string; files: { sha512: string }[] } | undefined;
  override checkForUpdates(): Promise<never> {
    this.checks += 1;
    return this.answer().then(() => Promise.reject(new Error('checked')));
  }
  private async answer(): Promise<void> {
    // The library's own 'checking' is dropped: the gate reported one before it verified.
    this.emit('checking-for-update');
    if (!this.offer) return;
    const supported = await this.isUpdateSupported(this.offer);
    this.emit(supported ? 'update-available' : 'update-not-available', { version: this.offer.version });
  }
}

function setup(check: ManifestCheck, snapshotSha = SHA_HEX) {
  const updater = new OfferingUpdater();
  const native = new FakeNative();
  const events: UpdateEvent[] = [];
  const snapshot = { ...fakeSnapshot(), sha512: snapshotSha };
  const gate = createManifestGate(check);
  const updates = startUpdates({
    updater,
    native,
    verifyDownload: vi.fn(async () => ok({ identity: GOOD, snapshot })),
    serveToSquirrel: vi.fn(async () => ({ url: 'http://127.0.0.1:1/t/feed', close: vi.fn() })),
    feedUrl: 'https://feed.example/channel-beta/',
    channel: 'beta',
    manifest: gate,
    onEvent: (event) => events.push(event),
    schedule: { initialDelayMs: 1_000_000, intervalMs: 1_000_000 },
    timers: { setTimeout: () => 'first', setInterval: () => 'interval', clear: () => undefined },
  });
  return { updater, native, events, updates, snapshot };
}

const signed: ManifestCheck = async () => ok(OFFER);

describe('the signed-manifest gate in the update pipeline (SB-19)', () => {
  it('checks the signature first, then lets the update library offer and stage exactly the signed zip', async () => {
    const check = vi.fn(signed);
    const { updater, native, events, updates } = setup(check);
    updater.offer = { version: '0.0.2', files: [{ sha512: SHA }] };
    await updates.checkNow();
    expect(check).toHaveBeenCalledWith('https://feed.example/channel-beta/', 'beta');
    updater.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/cache/update.zip' });
    await settle();
    expect(native.staged).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['checking', 'available', 'downloaded', 'verified']);
  });

  it('asks the update library nothing after a refused channel file', async () => {
    const refusal = UpdateManifestUntrusted({ channel: 'beta' });
    const { updater, events, updates } = setup(async () => err({ kind: 'refused', error: refusal }));
    updater.offer = { version: '0.0.2', files: [{ sha512: SHA }] };
    await updates.checkNow();
    expect(updater.checks).toBe(0);
    expect(events).toEqual([
      { type: 'checking', feedUrl: 'https://feed.example/channel-beta/' },
      { type: 'rejected', error: refusal },
    ]);
  });

  it('reports a missing channel file as a failed check, as the update library would', async () => {
    const { updater, events, updates } = setup(async () =>
      err({ kind: 'failed', message: 'Cannot find channel' }),
    );
    await updates.checkNow();
    expect(updater.checks).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Cannot find channel' });
  });

  it('refuses an offer that differs from the signed file, without a misleading "not available"', async () => {
    for (const offer of [
      { version: '0.0.3', files: [{ sha512: SHA }] },
      { version: '0.0.2', files: [{ sha512: `${'B'.repeat(86)}==` }] },
      { version: '0.0.2', files: [{ sha512: SHA }, { sha512: `${'B'.repeat(86)}==` }] },
    ]) {
      const { updater, events, updates } = setup(signed);
      updater.offer = offer;
      await updates.checkNow();
      expect(
        events.map((event) => event.type),
        JSON.stringify(offer),
      ).toEqual(['checking', 'rejected']);
      expect(events[1]).toMatchObject({ error: { code: 'desktop.update_manifest_mismatch' } });
    }
  });

  it('never stages a download whose bytes are not the signed zip', async () => {
    const { updater, native, events, updates, snapshot } = setup(signed, 'f'.repeat(128));
    updater.offer = { version: '0.0.2', files: [{ sha512: SHA }] };
    await updates.checkNow();
    updater.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/cache/update.zip' });
    await settle();
    expect(native.staged).toBe(0);
    expect(snapshot.disposed).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'rejected',
      error: { code: 'desktop.update_manifest_mismatch' },
    });
  });

  it('reports a check that threw as an error and asks nothing more', async () => {
    const { updater, events, updates } = setup(async () => Promise.reject(new Error('boom')));
    await updates.checkNow();
    expect(updater.checks).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'boom' });
  });
});
