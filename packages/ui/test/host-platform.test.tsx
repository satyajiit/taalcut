// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LNX1-SHL: the kit off a Mac. The platform from the page's navigator, shortcuts as a PC's keys, and the window bar
// when the system draws the window's controls (Linux and Windows' controls overlay).
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ariaKeyShortcuts,
  controlsOverlay,
  HostPlatformProvider,
  keyboardOf,
  matchesShortcut,
  parseShortcut,
  platformFromNavigator,
  shortcutKeys,
  useKeyboard,
  useShortcutFormat,
  useWindowControlsOverlay,
  WindowBar,
  WindowControls,
  type ControlsOverlay,
  type HostPlatform,
  type KeyWords,
} from '../src/index';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Taalcut/0.4.0 Chrome/152.0.7977.149 Electron/44.7.2 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Taalcut/0.4.0 Chrome/152.0.7977.149 Electron/44.7.2 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Taalcut/0.4.0 Chrome/152.0.7977.149 Electron/44.7.2 Safari/537.36',
};

const WORDS: KeyWords = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  escape: 'Esc',
  backspace: 'Backspace',
  delete: 'Del',
  tab: 'Tab',
};

describe('platformFromNavigator', () => {
  it('reads Client Hints first, then navigator.platform and the user agent', () => {
    expect(platformFromNavigator({ userAgentData: { platform: 'Linux' }, platform: 'Linux x86_64' })).toBe(
      'linux',
    );
    expect(platformFromNavigator({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(platformFromNavigator({ userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(platformFromNavigator({ platform: 'MacIntel', userAgent: UA.mac })).toBe('mac');
    expect(platformFromNavigator({ platform: 'Linux x86_64', userAgent: UA.linux })).toBe('linux');
    expect(platformFromNavigator({ platform: 'Win32', userAgent: UA.windows })).toBe('windows');
  });

  it('takes an OS it doesn’t know, or nothing at all, for Linux’s', () => {
    expect(platformFromNavigator({ userAgentData: { platform: 'Chrome OS' } })).toBe('linux');
    expect(platformFromNavigator({})).toBe('linux');
  });
});

describe('shortcuts on a PC', () => {
  it('are the words on its keys, Ctrl for ⌘, with Mod and Ctrl shown once', () => {
    expect(shortcutKeys(parseShortcut('mod+shift+z'), WORDS)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(shortcutKeys(parseShortcut('mod+alt+k'), WORDS)).toEqual(['Ctrl', 'Alt', 'K']);
    expect(shortcutKeys(parseShortcut('ctrl+mod+s'), WORDS)).toEqual(['Ctrl', 'S']);
    expect(shortcutKeys(parseShortcut('mod+enter'), WORDS)).toEqual(['Ctrl', 'Enter']);
    expect(shortcutKeys(parseShortcut('escape'), WORDS)).toEqual(['Esc']);
    expect(shortcutKeys(parseShortcut('mod+-'), WORDS)).toEqual(['Ctrl', '-']);
    // Arrows keep their glyphs: a PC's keys show them too.
    expect(shortcutKeys(parseShortcut('shift+arrowup'), WORDS)).toEqual(['Shift', '↑']);
  });

  it('the Mac keeps its glyphs in its own order, and its minus sign', () => {
    expect(shortcutKeys(parseShortcut('ctrl+mod+s'))).toEqual(['⌃', '⌘', 'S']);
    expect(shortcutKeys(parseShortcut('mod+-'))).toEqual(['⌘', '−']);
  });

  it('name Control to assistive technology off a Mac, and Meta on one', () => {
    expect(ariaKeyShortcuts(parseShortcut('mod+shift+a'), 'linux')).toBe('Control+Shift+A');
    expect(ariaKeyShortcuts(parseShortcut('mod+shift+a'), 'windows')).toBe('Control+Shift+A');
    expect(ariaKeyShortcuts(parseShortcut('mod+shift+a'), 'mac')).toBe('Meta+Shift+A');
    expect(ariaKeyShortcuts(parseShortcut('ctrl+mod+s'), 'linux')).toBe('Control+S');
    expect(ariaKeyShortcuts(parseShortcut('ctrl+mod+s'))).toBe('Control+Meta+S');
  });
});

describe('the keyboard core binds for', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  it('is the Mac’s on a Mac and a PC’s on Linux and Windows; the Mac without a provider', () => {
    expect(keyboardOf('mac')).toBe('mac');
    expect(keyboardOf('linux')).toBe('pc');
    expect(keyboardOf('windows')).toBe('pc');
    expect(renderHook(() => useKeyboard()).result.current).toBe('mac');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HostPlatformProvider platform="linux">{children}</HostPlatformProvider>
    );
    expect(renderHook(() => useKeyboard(), { wrapper }).result.current).toBe('pc');
  });

  it('lets a PC’s Ctrl+B toggle the sidebar, where ⌃⌘S never matched a PC’s keys at all', () => {
    // LNX1-PKG: core's view.sidebar is mod+b on a PC (pcShortcut), ctrl+mod+s on a Mac.
    const ctrlB = key({ key: 'b', code: 'KeyB', ctrlKey: true });
    const ctrlS = key({ key: 's', code: 'KeyS', ctrlKey: true });
    expect(matchesShortcut(ctrlB, parseShortcut('mod+b'))).toBe(true);
    expect(matchesShortcut(ctrlS, parseShortcut('ctrl+mod+s'))).toBe(false);
    expect(
      matchesShortcut(
        key({ key: 's', code: 'KeyS', ctrlKey: true, metaKey: true }),
        parseShortcut('ctrl+mod+s'),
      ),
    ).toBe(true);
    expect(shortcutKeys(parseShortcut('mod+b'), WORDS)).toEqual(['Ctrl', 'B']);
    expect(ariaKeyShortcuts(parseShortcut('mod+b'), 'linux')).toBe('Control+B');
  });
});

describe('useShortcutFormat', () => {
  const format = (platform?: HostPlatform) =>
    renderHook(() => useShortcutFormat(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <I18nProvider i18n={i18n}>
          {platform ? <HostPlatformProvider platform={platform}>{children}</HostPlatformProvider> : children}
        </I18nProvider>
      ),
    }).result.current;

  it('shows one source of shortcuts as the platform does, the Mac without a provider', () => {
    const linux = format('linux');
    expect(linux.text('mod+shift+z')).toBe('Ctrl+Shift+Z');
    expect(linux.keys('mod+,')).toEqual(['Ctrl', ',']);
    expect(linux.aria('mod+z')).toBe('Control+Z');
    const mac = format();
    expect(mac.text('mod+shift+z')).toBe('⇧⌘Z');
    expect(mac.aria('mod+z')).toBe('Meta+Z');
    expect(format('windows').text('mod+-')).toBe('Ctrl+-');
  });
});

/** A stand-in for navigator.windowControlsOverlay, which jsdom doesn't have. */
function fakeOverlay(visible: boolean): ControlsOverlay & { set(visible: boolean): void } {
  const target = new EventTarget() as ControlsOverlay & { set(visible: boolean): void };
  let now = visible;
  Object.defineProperty(target, 'visible', { get: () => now });
  target.set = (next) => {
    now = next;
    target.dispatchEvent(new Event('geometrychange'));
  };
  return target;
}

describe('the controls overlay', () => {
  it('is null where the browser has none, and follows geometrychange (full screen hides it)', () => {
    expect(controlsOverlay({} as Navigator)).toBeNull();
    const overlay = fakeOverlay(true);
    expect(controlsOverlay({ windowControlsOverlay: overlay } as unknown as Navigator)).toBe(overlay);
    const { result } = renderHook(() => useWindowControlsOverlay(overlay));
    expect(result.current).toBe(true);
    act(() => overlay.set(false));
    expect(result.current).toBe(false);
    expect(renderHook(() => useWindowControlsOverlay(null)).result.current).toBe(false);
  });

  it('the bar then draws no controls of its own and leaves the overlay’s corner free', () => {
    const bar = (props: { systemControls?: boolean; fullScreen?: boolean }) => (
      <I18nProvider i18n={i18n}>
        <WindowBar controls={<WindowControls onAction={() => {}} />} title="Library" {...props} />
      </I18nProvider>
    );
    const { container, rerender } = render(bar({ systemControls: true }));
    const spacer = () => container.querySelector<HTMLElement>('[data-slot=window-bar-system-controls]');
    expect(screen.queryByRole('group', { name: 'Window controls' })).toBeNull();
    // No lead band for controls that aren't there: the title starts at the window's edge.
    expect(container.querySelector('[data-slot=window-bar-lead]')).toBeNull();
    expect(spacer()?.getAttribute('aria-hidden')).toBe('true');
    expect(spacer()?.style.width).toContain('env(titlebar-area-x');
    // The bar is still the window's drag region.
    expect(container.querySelector('[data-slot=window-bar]')?.classList.contains('app-drag')).toBe(true);
    rerender(bar({ systemControls: true, fullScreen: true }));
    expect(spacer()).toBeNull();
    rerender(bar({}));
    expect(screen.getByRole('group', { name: 'Window controls' })).toBeTruthy();
    expect(spacer()).toBeNull();
  });
});
