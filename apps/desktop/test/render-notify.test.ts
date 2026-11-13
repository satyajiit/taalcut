// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** "Notify me" (P2-M11): render.finished with notify posts a notification; clicking it focuses the app. */
import { describe, expect, it, vi } from 'vitest';
import { createEventBus, newId, systemClock } from '@taalcut/core';
import { mainI18n } from '../src/main/i18n/i18n';
import { startRenderNotifications, type NotificationLike } from '../src/main/render/render-notify';

function harness(supported = true) {
  const events = createEventBus({ clock: systemClock });
  const shown: {
    title: string;
    body: string;
    listeners: Map<string, () => void>;
    show: ReturnType<typeof vi.fn>;
  }[] = [];
  const focus = vi.fn();
  const stop = startRenderNotifications({
    events,
    i18n: mainI18n('en'),
    isSupported: () => supported,
    create: (options) => {
      const listeners = new Map<string, () => void>();
      const entry = { ...options, listeners, show: vi.fn() };
      shown.push(entry);
      const notification: NotificationLike = {
        show: entry.show,
        on: (event, listener) => listeners.set(event, listener),
      };
      return notification;
    },
    focus,
  });
  const finish = (status: 'ready' | 'needsAttention' | 'failed' | 'cancelled', notify = true) =>
    events.emit('render.finished', {
      renderId: newId<'Render'>(),
      projectId: newId<'Project'>(),
      status,
      notify,
      name: 'Goa trip – Reels',
    });
  return { shown, focus, finish, stop };
}

describe('render notifications', () => {
  it('posts one notification for a ready render the user asked about, and clicking focuses the app', () => {
    const { shown, focus, finish } = harness();
    finish('ready');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      title: 'Your video is ready',
      body: 'Goa trip – Reels passed its checks and is in Renders.',
    });
    expect(shown[0]!.show).toHaveBeenCalledTimes(1);
    shown[0]!.listeners.get('click')?.();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('says what happened for needsAttention and failed renders', () => {
    const { shown, finish } = harness();
    finish('needsAttention');
    finish('failed');
    expect(shown.map((entry) => entry.title)).toEqual(['Your video needs a look', 'Your video wasn’t made']);
    expect(shown[1]!.body).toContain('Goa trip – Reels');
  });

  it('stays quiet without notify, for a cancelled render, or where notifications are unsupported', () => {
    const quiet = harness();
    quiet.finish('ready', false);
    quiet.finish('cancelled');
    expect(quiet.shown).toHaveLength(0);
    const unsupported = harness(false);
    unsupported.finish('ready');
    expect(unsupported.shown).toHaveLength(0);
  });

  it('stops listening when stopped', () => {
    const { shown, finish, stop } = harness();
    stop();
    finish('ready');
    expect(shown).toHaveLength(0);
  });

  it('has the texts in the pseudo-locale too', () => {
    const i18n = mainI18n('en-XA');
    const title = i18n._({ id: 'notify.render.ready.title' });
    expect(title).not.toBe('notify.render.ready.title');
    expect(title).not.toBe('Your video is ready');
  });
});
