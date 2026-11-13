// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's theme saves (IX3-F7, F2): one after another in the order asked, main's own write tells the watchers
 * what is saved as command.changed does for the agent's, and a failed save shows the saved theme again and comes
 * back to the window as an error. Electron's nativeTheme is a stand-in here.
 */
import {
  createEventBus,
  createMemorySettingsStore,
  err,
  ProcessRestartedError,
  systemClock,
  THEME_SETTING,
  ValidationError,
  type SettingsStore,
  type ThemePreference,
} from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { themeSetting } from '../src/main/composition/theme-setting';
import { setupTheme } from '../src/main/theme';

vi.mock('electron', () => ({
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: () => undefined,
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

const agentDown = () => Promise.reject(ProcessRestartedError({ process: 'agent' }));

function setup(dispatch: (preference: ThemePreference) => Promise<unknown>, settings?: SettingsStore) {
  const store = settings ?? createMemorySettingsStore();
  const log = vi.fn();
  const theme = themeSetting({
    settings: store,
    events: createEventBus({ clock: systemClock }),
    dispatch,
    log,
  });
  return { settings: store, log, theme };
}

/** A settings store whose writes fail (a locked library). */
function lockedSettings(): SettingsStore {
  const inner = createMemorySettingsStore();
  return {
    get: (setting) => inner.get(setting),
    set: async () => err(ValidationError({ field: 'theme' })),
    reset: (setting) => inner.reset(setting),
  };
}

describe("main's theme saves (IX3-F7, F2)", () => {
  it('saves one after another: an older choice whose dispatch fails late cannot land after a newer one', async () => {
    const answers: Array<(fail: boolean) => void> = [];
    const dispatched: ThemePreference[] = [];
    const { theme, settings } = setup(
      (preference) =>
        new Promise((resolve, reject) => {
          dispatched.push(preference);
          answers.push((fail) =>
            fail ? reject(ProcessRestartedError({ process: 'agent' })) : resolve(undefined),
          );
        }),
    );
    const dark = theme.save('dark');
    const light = theme.save('light');
    await vi.waitFor(() => expect(dispatched).toEqual(['dark']));
    answers[0]?.(true);
    await vi.waitFor(() => expect(dispatched).toEqual(['dark', 'light']));
    answers[1]?.(true);
    expect(await dark).toMatchObject({ ok: true });
    expect(await light).toMatchObject({ ok: true });
    expect(await settings.get(THEME_SETTING)).toMatchObject({ ok: true, value: 'light' });
  });

  it("tells the watchers after main's own write, as command.changed does for the agent's", async () => {
    const { theme } = setup(agentDown);
    const applied: ThemePreference[] = [];
    const stop = theme.watch((preference) => applied.push(preference));
    await theme.save('dark');
    expect(applied).toEqual(['dark']);
    stop();
    await theme.save('light');
    expect(applied).toEqual(['dark']);
  });

  it('a failed save is an error, and the watchers are shown what is saved', async () => {
    const { theme, log } = setup(agentDown, lockedSettings());
    const applied: ThemePreference[] = [];
    theme.watch((preference) => applied.push(preference));
    const saved = await theme.save('dark');
    expect(saved).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    expect(applied).toEqual(['system']);
    expect(log).toHaveBeenCalledWith('[theme] not saved: core.validation');
  });

  it('set rejects a failed save after showing the saved theme, so the window shows it too', async () => {
    const { theme: setting } = setup(agentDown, lockedSettings());
    const theme = setupTheme('system', (preference) => setting.save(preference));
    setting.watch((preference) => theme.apply(preference));
    await expect(Promise.resolve(theme.set('dark'))).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
    expect(theme.get().preference).toBe('system');
  });

  it("set shows the theme main had when the save fails and the library can't be read back (IX3-F8)", async () => {
    const unreadable: SettingsStore = {
      ...lockedSettings(),
      get: async () => err(ValidationError({ field: 'theme' })),
    };
    const { theme: setting } = setup(agentDown, unreadable);
    const theme = setupTheme('light', (preference) => setting.save(preference));
    setting.watch((preference) => theme.apply(preference));
    await expect(Promise.resolve(theme.set('dark'))).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
    expect(theme.get().preference).toBe('light');
  });

  it('an older failed save leaves a newer choice on screen, and a kept one is what a later failure shows', async () => {
    const inner = createMemorySettingsStore();
    const darkFails: SettingsStore = {
      get: async () => err(ValidationError({ field: 'theme' })),
      set: (setting, value, context) =>
        value === 'dark'
          ? Promise.resolve(err(ValidationError({ field: 'theme' })))
          : inner.set(setting, value, context),
      reset: (setting) => inner.reset(setting),
    };
    const { theme: setting } = setup(agentDown, darkFails);
    const theme = setupTheme('system', (preference) => setting.save(preference));
    const dark = Promise.resolve(theme.set('dark'));
    const light = Promise.resolve(theme.set('light'));
    await expect(dark).rejects.toMatchObject({ data: { code: 'core.validation' } });
    expect(theme.get().preference).toBe('light');
    await expect(light).resolves.toMatchObject({ preference: 'light' });
    await expect(Promise.resolve(theme.set('dark'))).rejects.toMatchObject({
      data: { code: 'core.validation' },
    });
    expect(theme.get().preference).toBe('light');
  });

  it('set answers with the new state when the save is kept', async () => {
    const { theme: setting } = setup(agentDown);
    const theme = setupTheme('system', (preference) => setting.save(preference));
    expect(await theme.set('light')).toMatchObject({ preference: 'light' });
  });
});
