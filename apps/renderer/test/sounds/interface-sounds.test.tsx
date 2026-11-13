// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { SETTINGS_COMMANDS } from '@taalcut/core';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUNDS_STORAGE_KEY } from '../../src/features/sounds/interface-sounds';
import { renderApp } from '../render-app';

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Settings › General › Sounds', () => {
  it('defaults on, saves off, and previews only an explicitly saved enable', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { client } = await renderApp('/settings/general');
    const toggle = await screen.findByRole('switch', { name: 'Interface sounds' });
    await waitFor(async () =>
      expect(await client.interfaceSounds.state()).toEqual({
        enabled: true,
        initialized: true,
      }),
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(play).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(toggle));
    await waitFor(async () => expect((await client.interfaceSounds.state()).enabled).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(play).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(toggle));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((play.mock.instances[0] as HTMLAudioElement).src).toContain('edit-applied');
  });

  it('migrates an existing off preference without a startup cue', async () => {
    localStorage.setItem(SOUNDS_STORAGE_KEY, 'off');
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { client } = await renderApp('/settings/general');
    const toggle = await screen.findByRole('switch', { name: 'Interface sounds' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(await client.interfaceSounds.state()).toEqual({ enabled: false, initialized: true });
    expect(localStorage.getItem(SOUNDS_STORAGE_KEY)).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it('follows another window command and immediately stops audio', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const { client } = await renderApp('/settings/general');
    const toggle = await screen.findByRole('switch', { name: 'Interface sounds' });
    await waitFor(async () => expect((await client.interfaceSounds.state()).initialized).toBe(true));
    await waitFor(() => expect(toggle.getAttribute('aria-busy')).not.toBe('true'));
    await act(async () => fireEvent.click(toggle));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    await act(async () => fireEvent.click(toggle));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    pause.mockClear();
    await act(async () => {
      await client.commands.dispatch({
        name: SETTINGS_COMMANDS.setInterfaceSounds,
        payload: { enabled: false },
        source: 'ui',
      });
    });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
  });
});
