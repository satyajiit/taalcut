// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The engine's saves (IX3-F7, F2): one in flight, a newer click replaces one still waiting, and a failed save shows
 * again what the store really keeps. The stores here hold each save until the test answers it.
 */
import type { ThemePreference } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemeEngine, electronStore, type ThemeBridge, type ThemeStore } from '../src';

interface HeldSave {
  readonly preference: ThemePreference;
  keep(): void;
  fail(): void;
}

/** A store whose saves wait for the test; `kept` is what it holds, `push` announces a change. */
function heldStore(initial: ThemePreference) {
  let kept = initial;
  let inFlight = 0;
  let most = 0;
  let listener: ((preference: ThemePreference) => void) | undefined;
  const held: HeldSave[] = [];
  const store: ThemeStore = {
    load: () => kept,
    save: (preference) =>
      new Promise<void>((resolve, reject) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        held.push({
          preference,
          keep: () => {
            inFlight -= 1;
            kept = preference;
            resolve();
          },
          fail: () => {
            inFlight -= 1;
            reject(new Error('library locked'));
          },
        });
      }),
    subscribe: (next) => {
      listener = next;
      return () => (listener = undefined);
    },
  };
  return {
    store,
    held,
    kept: () => kept,
    most: () => most,
    push: (preference: ThemePreference) => listener?.(preference),
  };
}

const shown = () => document.documentElement.getAttribute('data-theme-preference');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  errors.mockRestore();
});

describe('theme saves (IX3-F7, F2)', () => {
  it('a second click while the first save is in flight: one save at a time, and the newest choice wins', async () => {
    const { store, held, kept, most } = heldStore('system');
    const engine = createThemeEngine({ store });
    await engine.init();
    const dark = engine.setPreference('dark', { from: { x: 1, y: 2 } });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const light = engine.setPreference('light', { from: { x: 1, y: 2 } });
    const system = engine.setPreference('system');
    await vi.waitFor(() => expect(shown()).toBe('system'));
    // Light was replaced while it waited; dark is still the only save in hand.
    expect(held.map((save) => save.preference)).toEqual(['dark']);
    held[0]?.keep();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(held[1]?.preference).toBe('system');
    held[1]?.keep();
    await Promise.all([dark, light, system]);
    expect(most()).toBe(1);
    expect(kept()).toBe('system');
    expect(shown()).toBe('system');
  });

  it('a failed save puts back the theme the store kept, and the switch still resolves', async () => {
    const { store, held } = heldStore('light');
    const engine = createThemeEngine({ store });
    await engine.init();
    const seen: ThemePreference[] = [];
    engine.subscribe((state) => seen.push(state.preference));
    const dark = engine.setPreference('dark', { from: { x: 1, y: 2 } });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(shown()).toBe('dark');
    held[0]?.fail();
    await expect(dark).resolves.toBeUndefined();
    expect(shown()).toBe('light');
    expect(seen).toEqual(['dark', 'light']);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('dark was not saved'), expect.any(Error));
  });

  it('a failed save with a newer click waiting goes on to the newer one, without showing the old theme', async () => {
    const { store, held, kept } = heldStore('system');
    const engine = createThemeEngine({ store });
    await engine.init();
    const seen: ThemePreference[] = [];
    engine.subscribe((state) => seen.push(state.preference));
    const dark = engine.setPreference('dark', { instant: true });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const light = engine.setPreference('light', { instant: true });
    held[0]?.fail();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1]?.keep();
    await Promise.all([dark, light]);
    expect(kept()).toBe('light');
    expect(seen).toEqual(['dark', 'light']);
  });

  it('a failed save after a kept one goes back to the kept one, not to the start', async () => {
    const { store, held } = heldStore('system');
    const engine = createThemeEngine({ store });
    await engine.init();
    const dark = engine.setPreference('dark', { instant: true });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    held[0]?.keep();
    await dark;
    const light = engine.setPreference('light', { instant: true });
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1]?.fail();
    await light;
    expect(shown()).toBe('dark');
  });

  it("an announcement while our saves run (an older click's echo) doesn't flip the theme; the store is asked after", async () => {
    const { store, held, push } = heldStore('system');
    const engine = createThemeEngine({ store });
    await engine.init();
    const dark = engine.setPreference('dark', { instant: true });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const light = engine.setPreference('light', { instant: true });
    push('dark');
    await settle();
    expect(shown()).toBe('light');
    held[0]?.keep();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1]?.keep();
    await Promise.all([dark, light]);
    expect(shown()).toBe('light');
    // Once nothing of ours is saving, announcements show at once.
    push('dark');
    expect(shown()).toBe('dark');
  });

  it("Electron: a rejected set shows main's preference again", async () => {
    let mains: ThemePreference = 'light';
    const bridge: ThemeBridge = {
      get: vi.fn(async () => mains),
      set: vi.fn(async () => {
        // Main put back the library's preference before it answered (apps/desktop theme.ts).
        mains = 'light';
        throw new Error('core.internal');
      }),
      onChange: () => () => undefined,
    };
    const engine = createThemeEngine({ store: electronStore(bridge) });
    await engine.init();
    await engine.setPreference('dark', { instant: true });
    expect(bridge.get).toHaveBeenCalledTimes(2);
    expect(shown()).toBe('light');
  });
});
