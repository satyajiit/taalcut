// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  createEventBus,
  createMemorySettingsStore,
  newId,
  systemClock,
  UPDATE_CHANNEL_SETTING,
  UPDATE_COMMANDS,
} from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  channelInForce,
  channelSetting,
  effectiveFeed,
  feedUrlFor,
  isPublicChannel,
} from '../src/main/update/channel-setting';
import { createUpdateHost } from '../src/main/update/host';
import { MAX_NOTES_LENGTH, releaseDateOf, releaseNotesFor } from '../src/main/update/release-notes';
import { deltaLogger, type UpdateEvent } from '../src/main/update/updater';
import { FakeUpdater, setup } from './helpers/update-fakes';

const BASE = 'https://github.com/taalcut/taalcut/releases/download';

describe('public channels', () => {
  it('reads each channel from its fixed release', () => {
    expect(feedUrlFor(BASE, 'beta')).toBe(`${BASE}/channel-beta/`);
    expect(feedUrlFor(`${BASE}///`, 'stable')).toBe(`${BASE}/channel-stable/`);
    expect(isPublicChannel('beta')).toBe(true);
    expect(isPublicChannel('alpha')).toBe(false);
    expect(isPublicChannel(undefined)).toBe(false);
  });

  it("follows the person's choice on a public build: stable is latest-mac.yml, beta is beta-mac.yml", () => {
    expect(effectiveFeed({ feed: BASE, baked: 'stable', setting: null })).toEqual({
      feedUrl: `${BASE}/channel-stable/`,
      updaterChannel: undefined,
      channel: 'stable',
      choice: 'stable',
    });
    expect(effectiveFeed({ feed: BASE, baked: 'stable', setting: 'beta' })).toEqual({
      feedUrl: `${BASE}/channel-beta/`,
      updaterChannel: 'beta',
      channel: 'beta',
      choice: 'beta',
    });
    expect(effectiveFeed({ feed: BASE, baked: 'beta', setting: 'stable' })).toMatchObject({
      feedUrl: `${BASE}/channel-stable/`,
      updaterChannel: undefined,
      choice: 'stable',
    });
  });

  it('ignores the setting on team builds and builds without a channel (Phase 1 and 2 layout)', () => {
    expect(effectiveFeed({ feed: BASE, baked: 'alpha', setting: 'beta' })).toEqual({
      feedUrl: BASE,
      updaterChannel: 'alpha',
      channel: 'alpha',
      choice: null,
    });
    expect(effectiveFeed({ feed: BASE, baked: undefined, setting: 'beta' })).toEqual({
      feedUrl: BASE,
      updaterChannel: undefined,
      channel: null,
      choice: null,
    });
  });

  it('re-reads the stored choice after updates.setChannel and its undo, nothing else', async () => {
    const settings = createMemorySettingsStore();
    const events = createEventBus({ clock: systemClock });
    const applied: unknown[] = [];
    channelSetting({ settings, events }).watch((choice) => applied.push(choice));
    await settings.set(UPDATE_CHANNEL_SETTING, 'beta');
    const changed = (name: string) =>
      events.emit('command.changed', {
        kind: 'executed',
        id: newId<'Command'>(),
        name,
        projectId: null,
        source: 'ui',
        actor: 'user',
      });
    changed('settings.setTheme');
    changed(UPDATE_COMMANDS.setChannel);
    await vi.waitFor(() => expect(applied).toEqual(['beta']));
    await settings.set(UPDATE_CHANNEL_SETTING, null);
    changed(UPDATE_COMMANDS.setChannel);
    await vi.waitFor(() => expect(applied).toEqual(['beta', null]));
  });
});

describe('release notes', () => {
  const doc = (notes: Record<string, string>) => JSON.stringify({ v: 1, notes });

  it("picks the person's language, else English", () => {
    const raw = doc({ en: '- Faster export', hi: '- तेज़ निर्यात' });
    expect(releaseNotesFor(raw, 'hi')).toBe('- तेज़ निर्यात');
    expect(releaseNotesFor(raw, 'es')).toBe('- Faster export');
  });

  it('shows anything else as plain text: HTML stays characters, control characters go', () => {
    expect(releaseNotesFor('<b>Bold</b>\r\n- one\u0007', 'en')).toBe('<b>Bold</b>\n- one');
    expect(releaseNotesFor(JSON.stringify({ v: 2, notes: { en: 'x' } }), 'en')).toBe(
      '{"v":2,"notes":{"en":"x"}}',
    );
    expect(releaseNotesFor(doc({ hi: 'केवल हिंदी' }), 'hi')).toBe('{"v":1,"notes":{"hi":"केवल हिंदी"}}');
    expect(
      releaseNotesFor(
        [
          { version: '1.0.0', note: 'a' },
          { version: '0.9.0', note: null },
        ],
        'en',
      ),
    ).toBe('a');
    expect(releaseNotesFor('   ', 'en')).toBeUndefined();
    expect(releaseNotesFor(null, 'en')).toBeUndefined();
    expect(releaseNotesFor('x'.repeat(MAX_NOTES_LENGTH + 10), 'en')).toHaveLength(MAX_NOTES_LENGTH);
  });

  it('reads the date as epoch ms', () => {
    expect(releaseDateOf('2026-10-12T00:00:00.000Z')).toBe(Date.UTC(2026, 9, 12));
    expect(releaseDateOf('soon')).toBeUndefined();
    expect(releaseDateOf(undefined)).toBeUndefined();
  });
});

describe('update host, Phase 3', () => {
  const host = () =>
    createUpdateHost({
      version: '1.3.0-beta.1',
      channel: 'beta',
      enabled: true,
      choice: 'beta',
      clock: () => 5,
    });

  it('shows the choice and the last rollback', () => {
    const updates = host();
    expect(updates.state()).toMatchObject({ channel: 'beta', choice: 'beta', lastRollback: null });
    updates.noteRollback({ from: '1.3.0-beta.1', to: '1.3.0-beta.2', at: 9 });
    expect(updates.state().lastRollback).toEqual({ from: '1.3.0-beta.1', to: '1.3.0-beta.2', at: 9 });
    updates.configure({ version: '1.3.0-beta.1', channel: 'stable', enabled: true, choice: 'stable' });
    expect(updates.state()).toMatchObject({ channel: 'stable', choice: 'stable' });
  });

  it('marks a delta download and puts the notes and date of the offer on the ready state', () => {
    const updates = host();
    const apply = (event: UpdateEvent) => updates.apply(event);
    apply({ type: 'available', version: '1.3.0-beta.2' });
    updates.noteOffer('1.3.0-beta.9', { notes: 'not this one' });
    updates.noteOffer('1.3.0-beta.2', { notes: '- New', releaseDate: 1_000 });
    apply({ type: 'delta' });
    apply({ type: 'progress', percent: 50 });
    expect(updates.state().status).toEqual({
      kind: 'downloading',
      version: '1.3.0-beta.2',
      percent: 50,
      delta: true,
    });
    apply({ type: 'delta-failed' });
    expect(updates.state().status).toEqual({ kind: 'downloading', version: '1.3.0-beta.2', percent: 50 });
    apply({ type: 'downloaded', version: '1.3.0-beta.2' });
    apply({ type: 'verified', version: '1.3.0-beta.2', team: 'WW382UC8JD' });
    apply({ type: 'staged' });
    expect(updates.state().status).toEqual({
      kind: 'ready',
      version: '1.3.0-beta.2',
      notes: '- New',
      releaseDate: 1_000,
    });
  });

  it('reports the chosen channel for a public build, the baked one otherwise', async () => {
    const settings = createMemorySettingsStore();
    expect(await channelInForce(settings, 'stable')).toBe('stable');
    await settings.set(UPDATE_CHANNEL_SETTING, 'beta');
    expect(await channelInForce(settings, 'stable')).toBe('beta');
    expect(await channelInForce(settings, 'alpha')).toBe('alpha');
    expect(await channelInForce(settings, '')).toBe('');
  });

  it('puts notes translated after staging on the ready state too', () => {
    const updates = host();
    updates.apply({ type: 'available', version: '1.3.0-beta.2' });
    updates.apply({ type: 'verified', version: '1.3.0-beta.2', team: 'WW382UC8JD' });
    updates.apply({ type: 'staged' });
    expect(updates.state().status).toEqual({ kind: 'ready', version: '1.3.0-beta.2' });
    updates.noteOffer('1.3.0-beta.2', { notes: '- Late', releaseDate: 3 });
    expect(updates.state().status).toEqual({
      kind: 'ready',
      version: '1.3.0-beta.2',
      notes: '- Late',
      releaseDate: 3,
    });
  });

  it('streams the current state, then only the latest change', async () => {
    const updates = host();
    const controller = new AbortController();
    const stream = updates.changed(controller.signal);
    expect((await stream.next()).value).toMatchObject({ status: { kind: 'idle' } });
    updates.apply({ type: 'checking', feedUrl: BASE });
    updates.apply({ type: 'not-available', version: '1.3.0-beta.1' });
    expect((await stream.next()).value).toMatchObject({ status: { kind: 'idle', checkedAt: 5 } });
    controller.abort();
    expect((await stream.next()).done).toBe(true);
  });
});

describe('updater, Phase 3', () => {
  it('passes the release notes and date of an offer on', () => {
    const { updater, events } = setup();
    updater.emit('update-available', {
      version: '0.0.2',
      releaseNotes: '- x',
      releaseDate: '2026-10-12T00:00:00.000Z',
    });
    updater.emit('update-available', { version: '0.0.3' });
    expect(events).toEqual([
      { type: 'available', version: '0.0.2' },
      {
        type: 'release-info',
        version: '0.0.2',
        releaseNotes: '- x',
        releaseDate: '2026-10-12T00:00:00.000Z',
      },
      { type: 'available', version: '0.0.3' },
    ]);
  });

  it('re-points to another channel and checks at once, never allowing a downgrade', async () => {
    const updater = new FakeUpdater();
    const { updates } = setup(undefined, { channel: 'beta', updater });
    expect(updater.channel).toBe('beta');
    const checks = updater.checks;
    await updates.repoint(`${BASE}/channel-stable/`, undefined);
    expect(updater.feed).toEqual({ provider: 'generic', url: `${BASE}/channel-stable/` });
    // Once set, electron-updater's channel can't go back to null: the default channel is named.
    expect(updater.channel).toBe('latest');
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.checks).toBe(checks + 1);
  });

  it('refuses blocked versions through the updater hook', async () => {
    const updater = new FakeUpdater();
    setup(undefined, { updater, blocked: () => ['0.0.2'] });
    expect(await updater.isUpdateSupported({ version: '0.0.2' })).toBe(false);
    expect(await updater.isUpdateSupported({ version: '0.0.3' })).toBe(true);
  });

  it("reads a delta download from electron-updater 6.8's log lines", () => {
    const events: UpdateEvent[] = [];
    const logger = deltaLogger((event) => events.push(event));
    logger.info('Download block maps (old: "a", new: b)');
    logger.info('Staging percentage: 0.1');
    logger.error('Cannot download differentially, fallback to full download: boom');
    logger.error(new Error('other'));
    expect(events).toEqual([{ type: 'delta' }, { type: 'delta-failed' }]);
  });

  it('never prints the staging id electron-updater logs (security review SB-21)', () => {
    const printed: unknown[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => printed.push(...args)),
    );
    const id = '0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b';
    const logger = deltaLogger(() => {});
    logger.info(`Staging percentage: 10, percentage: 3.2, user id: ${id}`);
    logger.warn(`x-user-staging-id ${id}`);
    logger.error(`Cannot check for updates: ${id}`);
    for (const spy of spies) spy.mockRestore();
    expect(printed).toEqual([]);
  });
});
