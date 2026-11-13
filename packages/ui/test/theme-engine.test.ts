// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { ThemePreference } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createThemeEngine,
  defaultThemeStore,
  localStorageStore,
  THEME_STORAGE_KEY,
  type ThemeBridge,
  type ThemeStore,
} from '../src';
import { installMatchMedia } from './media';

const root = () => document.documentElement;

function memoryStore(initial: ThemePreference = 'system'): ThemeStore & { saved: ThemePreference[] } {
  const saved: ThemePreference[] = [];
  return { saved, load: () => initial, save: (p) => void saved.push(p) };
}

function fakeBridge(initial: ThemePreference) {
  let listener: ((p: ThemePreference) => void) | undefined;
  const bridge: ThemeBridge = {
    get: vi.fn(async () => initial),
    set: vi.fn(async () => undefined),
    onChange: vi.fn((l) => {
      listener = l;
      return () => (listener = undefined);
    }),
  };
  return { bridge, push: (p: ThemePreference) => listener?.(p), hasListener: () => listener !== undefined };
}

describe('createThemeEngine', () => {
  it('applies a stored dark choice to <html>', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(root().getAttribute('data-theme-preference')).toBe('dark');
    expect(engine.getState()).toEqual({ preference: 'dark', resolved: 'dark' });
  });

  it('follows the OS on system, with no data-theme', async () => {
    const os = installMatchMedia(true);
    const engine = createThemeEngine({ store: memoryStore('system') });
    const seen: string[] = [];
    engine.subscribe((s) => seen.push(s.resolved));
    await engine.init();
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(engine.getState().resolved).toBe('dark');
    os.setDark(false);
    expect(engine.getState().resolved).toBe('light');
    expect(seen).toEqual(['light']);
  });

  it('ignores OS changes while an explicit choice is set', async () => {
    const os = installMatchMedia(false);
    const engine = createThemeEngine({ store: memoryStore('light') });
    await engine.init();
    os.setDark(true);
    expect(engine.getState()).toEqual({ preference: 'light', resolved: 'light' });
  });

  it('saves a new preference, updates <html> and notifies once', async () => {
    const store = memoryStore();
    const engine = createThemeEngine({ store });
    await engine.init();
    const listener = vi.fn();
    engine.subscribe(listener);
    await engine.setPreference('dark');
    await engine.setPreference('dark');
    expect(store.saved).toEqual(['dark']);
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
    await engine.setPreference('system');
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('toggles from what is showing now', async () => {
    installMatchMedia(true);
    const engine = createThemeEngine({ store: memoryStore('system') });
    await engine.init();
    await engine.toggle();
    expect(engine.getState()).toEqual({ preference: 'light', resolved: 'light' });
    await engine.toggle();
    expect(engine.getState().preference).toBe('dark');
  });

  it('rejects an unknown preference as a bug', async () => {
    const engine = createThemeEngine({ store: memoryStore() });
    await engine.init();
    await expect(engine.setPreference('sepia' as ThemePreference)).rejects.toThrow(TypeError);
  });

  it('treats a corrupt stored value as system', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    const engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
    expect(engine.getState().preference).toBe('system');
  });

  it('freezes transitions for two frames while switching', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    // Its own root, so frames still pending from earlier tests can't touch it.
    const el = document.createElement('div');
    const engine = createThemeEngine({ store: memoryStore(), root: el });
    await engine.init();
    expect(el.hasAttribute('data-theme-switching')).toBe(true);
    frames.shift()?.(0);
    expect(el.hasAttribute('data-theme-switching')).toBe(true);
    frames.shift()?.(0);
    expect(el.hasAttribute('data-theme-switching')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('applies changes made in another tab', async () => {
    const engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    expect(engine.getState().preference).toBe('dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'light' }));
    expect(engine.getState().preference).toBe('dark');
  });

  it('stops listening after destroy', async () => {
    const os = installMatchMedia(false);
    const engine = createThemeEngine({ store: memoryStore() });
    await engine.init();
    expect(os.listenerCount()).toBe(1);
    engine.destroy();
    expect(os.listenerCount()).toBe(0);
  });
});

describe('stores', () => {
  it("uses main's theme when the renderer is connected to it", async () => {
    const { bridge, push, hasListener } = fakeBridge('dark');
    const engine = createThemeEngine({ store: defaultThemeStore(bridge) });
    await engine.init();
    expect(engine.getState().preference).toBe('dark');
    await engine.setPreference('light');
    expect(bridge.set).toHaveBeenCalledWith('light');
    push('system');
    expect(engine.getState().preference).toBe('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    engine.destroy();
    expect(hasListener()).toBe(false);
  });

  it('falls back to localStorage without a bridge', async () => {
    expect(window).not.toHaveProperty('taalcutTheme');
    const engine = createThemeEngine({ store: defaultThemeStore(null) });
    await engine.init();
    await engine.setPreference('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('survives blocked storage', async () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const spy = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked as unknown as Storage);
    const engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
    expect(engine.getState().preference).toBe('system');
    await expect(engine.setPreference('dark')).resolves.toBeUndefined();
    expect(root().getAttribute('data-theme')).toBe('dark');
    spy.mockRestore();
  });
});
