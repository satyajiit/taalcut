// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: main's notifications about the download of everything this Mac needs. One when it finishes (a
 * click focuses the app); one each time it stops with something the person has to deal with, naming the jobs and
 * why (a click opens Settings › Models on the first one's row). Never per retry, never for a pause or a cancel, and
 * nothing for what a launch finds; a refusal to start is said only while no Taalcut window has focus.
 */
import { describe, expect, it, vi } from 'vitest';
import { createEventBus, systemClock, type Component, type Downloads } from '@taalcut/core';
import { startDownloadsNotifications } from '../src/main/downloads/downloads-notify';
import { mainI18n } from '../src/main/i18n/i18n';
import type { NotificationLike } from '../src/main/render/render-notify';

function harness(options: { supported?: boolean } = {}) {
  const events = createEventBus({ clock: systemClock });
  const shown: { title: string; body: string; listeners: Map<string, () => void> }[] = [];
  const focus = vi.fn();
  const showDownloads = vi.fn();
  let focused = false;
  const stop = startDownloadsNotifications({
    events,
    i18n: mainI18n('en'),
    isSupported: () => options.supported ?? true,
    create: (texts) => {
      const listeners = new Map<string, () => void>();
      shown.push({ ...texts, listeners });
      const notification: NotificationLike = {
        show: () => undefined,
        on: (event, listener) => listeners.set(event, listener),
      };
      return notification;
    },
    windowFocused: () => focused,
    focus,
    showDownloads,
  });
  const report = (state: Downloads['state'], extra: Partial<Downloads> = {}) =>
    events.emit('components.downloads', { ...downloads(state), ...extra });
  return {
    shown,
    focus,
    showDownloads,
    report,
    stop,
    focusWindow: (value: boolean) => (focused = value),
  };
}

function downloads(state: Downloads['state']): Downloads {
  return {
    state,
    components: [],
    counts: { installed: 0, downloading: 0, queued: 0, paused: 0, failed: 0, missing: 0 },
    bytesTotal: 0,
    bytesDone: 0,
    bytesPerSecond: 0,
    requiredBytes: 0,
  };
}

const failure = (code: string, component: string) => ({
  code,
  messageKey: `errors.${code}`,
  retryable: true,
  params: { component },
});

function part(id: string, job: Component['job'], status: Component['status'], code?: string): Component {
  return {
    id,
    name: id,
    version: '1',
    licence: 'MIT',
    sizeBytes: 1,
    status,
    usedBy: [],
    ...(job ? { job } : {}),
    ...(code ? { error: failure(code, id) } : {}),
  };
}

const SPACE = {
  code: 'jobs.downloads_space_low',
  messageKey: 'errors.jobs.downloads_space_low',
  retryable: false,
  params: { requiredBytes: 9, availableBytes: 1 },
};

describe('the everything-downloaded notification', () => {
  it('posts once when the download finishes, and clicking it focuses the app', () => {
    const { shown, focus, report } = harness();
    report('downloading');
    report('downloading');
    report('ready');
    report('ready');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      title: 'Taalcut is ready',
      body: 'Everything this Mac needs has downloaded. Its models work offline from now on.',
    });
    shown[0]?.listeners.get('click')?.();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('says nothing at a launch that finds everything here, for a pause or for a cancel', () => {
    const { shown, report } = harness();
    report('ready');
    report('downloading');
    report('paused');
    report('ready');
    report('downloading');
    report('missing');
    expect(shown).toEqual([]);
  });
});

describe('the download-stopped notification', () => {
  it('names the jobs and why once per stop, and clicking it opens Settings › Models on the first one’s row', () => {
    const { shown, showDownloads, focus, report } = harness();
    const stopped = [
      part('whisper-cpp', 'speech', 'installed'),
      part('whisper-tiny', 'speech', 'failed', 'jobs.download_failed'),
      part('embeddinggemma-2', 'search', 'failed', 'jobs.checksum_mismatch'),
    ];
    report('downloading');
    // A part failing while the others carry on is not a stop; neither is a reconnect.
    report('downloading', { components: stopped });
    report('failed', { components: stopped });
    report('failed', { components: stopped });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      title: 'Couldn’t download the models for Speech and Search',
      body: 'The connection kept dropping. Check your internet connection, then try again.',
    });
    shown[0]?.listeners.get('click')?.();
    expect(showDownloads).toHaveBeenCalledWith('speech');
    expect(focus).not.toHaveBeenCalled();
    // Try again, and it stops again: a new stop, a new notification.
    report('downloading', { components: stopped });
    report('failed', { components: stopped });
    expect(shown).toHaveLength(2);
  });

  it('says a run that stopped even with a window in front', () => {
    const { shown, report, focusWindow } = harness();
    focusWindow(true);
    report('downloading');
    report('failed', { components: [part('beat-this', 'beats', 'failed', 'jobs.disk_space_low')] });
    expect(shown.map((each) => each.title)).toEqual(['Couldn’t download the models for Beats']);
    expect(shown[0]?.body).toBe(
      'This Mac doesn’t have enough free space for them. Free up some space, then try again.',
    );
  });

  it('says a refusal to start only while no window has focus, once, and a click opens the download', () => {
    const { shown, showDownloads, report, focusWindow } = harness();
    report('missing');
    // The person pressed Download in the window: the window says it.
    focusWindow(true);
    report('failed', { error: SPACE });
    expect(shown).toEqual([]);
    // The same refusal again, and then one while the window is in the background (the agent asked).
    report('failed', { error: SPACE });
    report('missing');
    focusWindow(false);
    report('failed', { error: SPACE });
    report('failed', { error: SPACE });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      title: 'Couldn’t download the models this Mac needs',
      body: 'This Mac doesn’t have enough free space for them. Free up some space, then try again.',
    });
    shown[0]?.listeners.get('click')?.();
    expect(showDownloads).toHaveBeenCalledWith(undefined);
  });

  it('says nothing for a stop it found at launch', () => {
    const parts = harness();
    parts.report('failed', {
      components: [part('whisper-tiny', 'speech', 'failed', 'jobs.download_failed')],
    });
    parts.report('failed', {
      components: [part('whisper-tiny', 'speech', 'failed', 'jobs.download_failed')],
    });
    const refused = harness();
    refused.report('failed', { error: SPACE });
    refused.report('failed', { error: SPACE });
    expect([...parts.shown, ...refused.shown]).toEqual([]);
  });
});

describe('either notification', () => {
  it('says nothing where notifications are not supported, and stops listening', () => {
    const quiet = harness({ supported: false });
    quiet.report('downloading');
    quiet.report('ready');
    quiet.report('downloading');
    quiet.report('failed', {
      components: [part('whisper-tiny', 'speech', 'failed', 'jobs.download_failed')],
    });
    expect(quiet.shown).toEqual([]);
    const stopped = harness();
    stopped.stop();
    stopped.report('downloading');
    stopped.report('ready');
    expect(stopped.shown).toEqual([]);
  });
});
