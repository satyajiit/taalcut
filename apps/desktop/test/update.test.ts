// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { err } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { UpdateNotNewer } from '../src/main/update/candidate';
import { resolveUpdateChannel, resolveUpdateFeed, updateFeedFileName } from '../src/main/update/feed';
import { DowngradingUpdater, setup } from './helpers/update-fakes';

describe('resolveUpdateFeed', () => {
  const baked = 'https://updates.taalcut.dev/dev/';

  it('never updates an unpackaged run', () => {
    expect(
      resolveUpdateFeed({ packaged: false, flavour: 'test', bakedFeed: baked, testFeed: baked }),
    ).toBeUndefined();
  });

  it('uses the baked-in feed, or none', () => {
    expect(resolveUpdateFeed({ packaged: true, flavour: 'release', bakedFeed: baked })).toBe(baked);
    expect(resolveUpdateFeed({ packaged: true, flavour: 'release', bakedFeed: '' })).toBeUndefined();
  });

  it('lets only test builds override it, and only with https or loopback http', () => {
    const local = 'http://127.0.0.1:4100/';
    expect(
      resolveUpdateFeed({ packaged: true, flavour: 'release', bakedFeed: '', testFeed: local }),
    ).toBeUndefined();
    expect(resolveUpdateFeed({ packaged: true, flavour: 'test', bakedFeed: baked, testFeed: local })).toBe(
      local,
    );
    expect(
      resolveUpdateFeed({ packaged: true, flavour: 'test', bakedFeed: '', testFeed: '' }),
    ).toBeUndefined();
    expect(() =>
      resolveUpdateFeed({ packaged: true, flavour: 'test', bakedFeed: '', testFeed: 'http://evil.example/' }),
    ).toThrow(/taalcut-update-feed/);
  });
});

describe('update channel', () => {
  it('names latest-mac.yml unless a channel is set', () => {
    expect(updateFeedFileName()).toBe('latest-mac.yml');
    expect(updateFeedFileName('')).toBe('latest-mac.yml');
    expect(updateFeedFileName('alpha')).toBe('alpha-mac.yml');
    expect(updateFeedFileName('internal')).toBe('internal-mac.yml');
    expect(() => updateFeedFileName('../alpha')).toThrow(/channel/);
  });

  it('uses the baked channel, and lets only a test build override it', () => {
    expect(resolveUpdateChannel({ flavour: 'release', bakedChannel: 'alpha', testChannel: 'internal' })).toBe(
      'alpha',
    );
    expect(resolveUpdateChannel({ flavour: 'release', bakedChannel: '' })).toBeUndefined();
    expect(resolveUpdateChannel({ flavour: 'test', bakedChannel: 'stable', testChannel: '  ' })).toBe(
      'stable',
    );
    expect(resolveUpdateChannel({ flavour: 'test', bakedChannel: '', testChannel: 'alpha' })).toBe('alpha');
    expect(() => resolveUpdateChannel({ flavour: 'test', bakedChannel: '', testChannel: 'nightly' })).toThrow(
      /taalcut-update-channel/,
    );
  });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startUpdates', () => {
  it('points electron-updater at the generic feed, downloads automatically, and stages nothing by itself', () => {
    const { updater, timers } = setup();
    expect(updater.feed).toEqual({ provider: 'generic', url: 'https://feed.example/' });
    expect(updater.autoDownload).toBe(true);
    // Otherwise electron-updater hands the zip to Squirrel before it is verified.
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.logger).not.toBeNull();
    expect(updater.checks).toBe(1);
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5);
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('verifies the downloaded zip, then has Squirrel stage the verified snapshot from its own feed', async () => {
    const { updater, native, events, verifyDownload, serveToSquirrel, feed, snapshot } = setup();
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.0.2' });
    updater.emit('download-progress', { percent: 41.6 });
    updater.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/cache/pending/update.zip' });
    await settle();
    expect(verifyDownload).toHaveBeenCalledWith('/cache/pending/update.zip');
    // Not electron-updater's proxy, which serves the cache file: the snapshot that was verified.
    expect(serveToSquirrel).toHaveBeenCalledWith(snapshot);
    expect(native.feed).toEqual({ url: feed.url });
    expect(native.staged).toBe(1);
    expect(feed.close).not.toHaveBeenCalled();
    native.emit('update-downloaded');
    // Staged: the feed and the snapshot go.
    expect(feed.close).toHaveBeenCalledOnce();
    expect(snapshot.disposed).toBe(1);
    updater.emit('update-not-available', { version: '0.0.1' });
    updater.emit('error', new Error('network down'));
    expect(events).toEqual([
      { type: 'checking', feedUrl: 'https://feed.example/' },
      { type: 'available', version: '0.0.2' },
      { type: 'progress', percent: 42 },
      { type: 'downloaded', version: '0.0.2' },
      { type: 'verified', version: '0.0.2', team: 'WW382UC8JD' },
      { type: 'staged' },
      { type: 'not-available', version: '0.0.1' },
      { type: 'error', message: 'network down' },
    ]);
  });

  it('rejects an update that fails verification with its typed error, and never stages it', async () => {
    const refusal = UpdateNotNewer({ version: '0.0.1', running: '0.0.1' });
    const { updater, native, events } = setup(async () => err(refusal));
    updater.emit('update-downloaded', { version: '9.9.9', downloadedFile: '/z.zip' });
    await settle();
    expect(events).toEqual([
      { type: 'downloaded', version: '9.9.9' },
      { type: 'rejected', error: refusal },
    ]);
    expect(native.staged).toBe(0);
  });

  it('cleans up when Squirrel fails, and when the feed cannot start', async () => {
    const failing = setup();
    failing.updater.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/z.zip' });
    await settle();
    failing.native.emit('error', new Error('code signature did not match'));
    expect(failing.feed.close).toHaveBeenCalledOnce();
    expect(failing.snapshot.disposed).toBe(1);

    const noFeed = setup();
    noFeed.serveToSquirrel.mockRejectedValueOnce(new Error('EADDRNOTAVAIL'));
    noFeed.updater.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/z.zip' });
    await settle();
    expect(noFeed.events.at(-1)).toMatchObject({ type: 'rejected', error: { code: 'core.unknown' } });
    expect(noFeed.native.staged).toBe(0);
    expect(noFeed.snapshot.disposed).toBe(1);
  });

  it('treats a verifier that throws as a rejection', async () => {
    const { updater, native, events } = setup(() => Promise.reject(new Error('ditto crashed')));
    updater.emit('update-downloaded', { version: '0.0.2', downloadedFile: '/z.zip' });
    await settle();
    expect(events.at(-1)).toMatchObject({ type: 'rejected', error: { code: 'core.unknown' } });
    expect(native.staged).toBe(0);
  });

  it('requests <channel>-mac.yml and forces allowDowngrade back off', () => {
    const updater = new DowngradingUpdater();
    const { native } = setup(undefined, { channel: 'alpha', updater });
    expect(updater.channel).toBe('alpha');
    expect(updater.feed).toEqual({ provider: 'generic', url: 'https://feed.example/', channel: 'alpha' });
    expect(updater.allowDowngrade).toBe(false);
    expect(native.installs).toBe(0);
  });

  it('treats an empty channel as the Phase 1 feed', () => {
    const { updater } = setup(undefined, { channel: '   ' });
    expect(updater.feed).toEqual({ provider: 'generic', url: 'https://feed.example/' });
    expect(updater.channel).toBeNull();
    expect(updater.allowDowngrade).toBe(false);
  });

  it('installNow asks Squirrel to quit and install', () => {
    const { updates, native } = setup();
    updates.installNow();
    expect(native.installs).toBe(1);
  });

  it('swallows a failed check (it arrives as an error event) and stops its timers', async () => {
    const { updates, timers } = setup();
    await expect(updates.checkNow()).resolves.toBeUndefined();
    updates.stop();
    expect(timers.clear).toHaveBeenCalledWith('first');
    expect(timers.clear).toHaveBeenCalledWith('interval');
  });
});
