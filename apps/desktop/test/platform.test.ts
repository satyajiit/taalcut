// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Seam 2 (LNX1-SHL): each platform's services, slot by slot, without Electron. */
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chromeColours } from '../src/main/theme-preferences';
import { hostPlatform, type PlatformServices } from '../src/platform';
import { darwin } from '../src/platform/darwin';
import { OVERLAY_HEIGHT } from '../src/platform/frame';
import { linux, xdgMediaCacheRoot } from '../src/platform/linux';
import type { ChromeWindow, SystemPreferencesPort } from '../src/platform/types';
import { win32 } from '../src/platform/win32';
import { hardwareSessionFolder } from '@taalcut/media';

function fakeWindow() {
  const listeners = new Map<string, () => void>();
  const win = {
    setWindowButtonVisibility: vi.fn(),
    setMenuBarVisibility: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
  } satisfies ChromeWindow;
  return { win, fire: (event: string) => listeners.get(event)?.() };
}

function fakePreferences(status: ReturnType<SystemPreferencesPort['getMediaAccessStatus']> = 'denied') {
  return {
    getUserDefault: vi.fn(() => 'Minimize'),
    getMediaAccessStatus: vi.fn(() => status),
    askForMediaAccess: vi.fn(() => Promise.resolve(false)),
  } satisfies SystemPreferencesPort;
}

describe('hostPlatform', () => {
  it('picks the services by process.platform once, and Linux’s for another Unix', () => {
    expect(hostPlatform('darwin')).toBe(darwin);
    expect(hostPlatform('linux')).toBe(linux);
    expect(hostPlatform('win32')).toBe(win32);
    expect(hostPlatform('freebsd')).toBe(linux);
    expect(hostPlatform().name).toBe(
      process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    );
  });
});

describe('window chrome', () => {
  const dark = chromeColours(true);

  it('macOS hides the title bar and the system lights, and again on the way in and out of full screen', () => {
    expect(darwin.window.options(dark)).toEqual({ titleBarStyle: 'hidden' });
    const { win, fire } = fakeWindow();
    darwin.window.attach(win);
    fire('enter-full-screen');
    fire('leave-full-screen');
    expect(win.setWindowButtonVisibility.mock.calls).toEqual([[false], [false], [false]]);
    darwin.window.recolour(win, dark);
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it('Linux and Windows overlay the system controls on the bar, in the theme’s colours, with no menu bar', () => {
    for (const platform of [linux, win32]) {
      expect(platform.window.options(dark)).toEqual({
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#181715', symbolColor: '#ceccc9', height: OVERLAY_HEIGHT },
        autoHideMenuBar: false,
      });
      const { win } = fakeWindow();
      platform.window.attach(win);
      expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false);
      expect(win.setWindowButtonVisibility).not.toHaveBeenCalled();
      platform.window.recolour(win, chromeColours(false));
      expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#faf6f1', symbolColor: '#48413b' });
    }
    // The bar is 52 px with a 1 px hairline the overlay leaves showing.
    expect(OVERLAY_HEIGHT).toBe(51);
  });
});

describe('menu and the last window', () => {
  it('macOS keeps its app menu and stays running; Linux and Windows quit with the last window', () => {
    expect(darwin.menu).toEqual({ appMenu: true, keyboard: 'mac', quitWhenAllWindowsClosed: false });
    expect(linux.menu).toEqual({ appMenu: false, keyboard: 'pc', quitWhenAllWindowsClosed: true });
    expect(win32.menu).toEqual(linux.menu);
  });

  it('follows macOS’s title-bar double-click setting; elsewhere the bar maximises', () => {
    const preferences = fakePreferences();
    expect(darwin.titleBarDoubleClick(preferences)).toBe('Minimize');
    expect(preferences.getUserDefault).toHaveBeenCalledWith('AppleActionOnDoubleClick', 'string');
    expect(linux.titleBarDoubleClick(fakePreferences())).toBeNull();
  });
});

describe('microphone', () => {
  it('on Linux is granted at the OS level, without asking systemPreferences', async () => {
    const preferences = fakePreferences('denied');
    const microphone = linux.microphone(preferences);
    expect(microphone.status()).toBe('granted');
    expect(await microphone.ask()).toBe(true);
    expect(preferences.getMediaAccessStatus).not.toHaveBeenCalled();
    expect(preferences.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('on macOS is TCC’s answer, and Windows reports its privacy setting', async () => {
    expect(darwin.microphone(fakePreferences('denied')).status()).toBe('denied');
    expect(darwin.microphone(fakePreferences('unknown')).status()).toBe('not-determined');
    const windows = win32.microphone(fakePreferences('granted'));
    expect(await windows.ask()).toBe(true);
  });
});

describe('media cache (XDG on Linux)', () => {
  const home = '/home/ada';

  it('puts ~/.config/Taalcut’s cache in ~/.cache/Taalcut', () => {
    expect(xdgMediaCacheRoot('/home/ada/.config/Taalcut', {}, home)).toBe('/home/ada/.cache/Taalcut');
  });

  it('follows XDG_CONFIG_HOME and XDG_CACHE_HOME, and ignores a relative one as the spec says', () => {
    const env = { XDG_CONFIG_HOME: '/srv/ada/config', XDG_CACHE_HOME: '/srv/ada/cache' };
    expect(xdgMediaCacheRoot('/srv/ada/config/Taalcut', env, home)).toBe('/srv/ada/cache/Taalcut');
    const relative = { XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache' };
    expect(xdgMediaCacheRoot('/home/ada/.config/Taalcut', relative, home)).toBe('/home/ada/.cache/Taalcut');
  });

  it('keeps a test’s (or a --user-data-dir’s) cache inside its userData', () => {
    expect(xdgMediaCacheRoot('/tmp/taalcut-e2e-1', {}, home)).toBe('/tmp/taalcut-e2e-1/media-cache');
    expect(xdgMediaCacheRoot('/home/ada/.config/Taalcut/nested', {}, home)).toBe(
      '/home/ada/.config/Taalcut/nested/media-cache',
    );
    expect(win32.mediaCacheRoot('C:\\Users\\ada\\AppData\\Roaming\\Taalcut')).toBe(
      join('C:\\Users\\ada\\AppData\\Roaming\\Taalcut', 'media-cache'),
    );
  });
});

describe('the other slots', () => {
  const all: readonly PlatformServices[] = [darwin, linux, win32];

  it('adds no GPU switch: none was measured as needed (desktop SPEC, "Platform services")', () => {
    // Linux's only one is the keyring's, outside a desktop session (secret-store-keyring.test.ts).
    for (const platform of all)
      expect(
        platform.electronSwitches.filter(({ name }) => name !== 'password-store'),
        platform.name,
      ).toEqual([]);
  });

  it('has no compile cache or native helper off a Mac', async () => {
    expect(linux.compileCache('/home/ada')).toBeUndefined();
    for (const platform of [linux, win32]) {
      const found = await platform
        .nativeHelper({ packaged: true, resourcesPath: '/opt/Taalcut/resources' })
        .resolve();
      expect(found.ok ? undefined : found.error.code).toBe('media.sidecar_not_found');
    }
  });

  it('delegates the probe and the session folder to their owners; Linux alone names a loader path', () => {
    for (const platform of all) {
      expect(typeof platform.hardwareProbe('/tmp/taalcut-data').probe).toBe('function');
      expect(platform.hardwareSessionDir()).toBe(hardwareSessionFolder({ platform: platform.name }));
      expect(typeof platform.volumeProbe().mountedUuids).toBe('function');
    }
  });

  it('says “this Mac” on a Mac alone, and keeps cable import, Local Network, updates and System Settings to it', () => {
    expect([darwin.words, linux.words, win32.words]).toEqual(['mac', 'computer', 'windows']);
    expect(Object.values(darwin.abilities).every(Boolean)).toBe(true);
    for (const platform of [linux, win32]) {
      expect(platform.abilities, platform.name).toEqual({
        cableImport: false,
        localNetworkPrivacy: false,
        selfUpdate: false,
        systemSettingsPanes: false,
        nativeSubjects: false,
        photosImport: false,
      });
    }
  });

  it('names LD_LIBRARY_PATH on Linux for the CUDA runtime, nothing on macOS, a slot on Windows', () => {
    expect(hostPlatform('linux').loaderSearchPath).toEqual({ variable: 'LD_LIBRARY_PATH', separator: ':' });
    expect(hostPlatform('darwin').loaderSearchPath).toBeUndefined();
    expect(hostPlatform('win32').loaderSearchPath).toBeUndefined();
  });

  it('confines the workspace shell with Seatbelt on macOS, bubblewrap on Linux, and nothing yet on Windows', () => {
    expect([darwin, linux, win32].map((platform) => platform.workspaceShell)).toEqual([
      'seatbelt',
      'bwrap',
      null,
    ]);
  });

  it.runIf(process.platform === 'linux')(
    'finds this machine’s root filesystem through the Linux volume probe',
    async () => {
      expect((await linux.volumeProbe().identify('/'))?.mountPoint).toBe('/');
    },
  );
});
