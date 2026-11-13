// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which OS the app runs on, as the UI needs it (LNX1-SHL): shortcut keys as the Mac's glyphs or as PC words, "This
 * Mac" or "This computer", and whether the system draws the window's controls. The app decides it once (Electron: the
 * page's own navigator; the preview: its fake) and provides it at the root; without a provider it is the Mac, as the
 * kit's previews and tests assume.
 */
import type { Keyboard } from '@taalcut/core';
import { createContext, useContext, type ReactNode } from 'react';

export const HOST_PLATFORMS = ['mac', 'linux', 'windows'] as const;
export type HostPlatform = (typeof HOST_PLATFORMS)[number];

const HostPlatformContext = createContext<HostPlatform>('mac');

export function HostPlatformProvider({
  platform,
  children,
}: {
  platform: HostPlatform;
  children: ReactNode;
}) {
  return <HostPlatformContext.Provider value={platform}>{children}</HostPlatformContext.Provider>;
}

export function useHostPlatform(): HostPlatform {
  return useContext(HostPlatformContext);
}

/** Whose keyboard core's bindings are for here (core's shortcutOn): the Mac's, or a PC's on Linux and Windows. */
export function keyboardOf(platform: HostPlatform): Keyboard {
  return platform === 'mac' ? 'mac' : 'pc';
}

/** keyboardOf the platform the app provides. */
export function useKeyboard(): Keyboard {
  return keyboardOf(useHostPlatform());
}

/** What a browser says about where it runs: User-Agent Client Hints where there are any, else the old fields. */
export interface NavigatorPlatform {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}

/** The OS Chromium reports ('macOS', 'Linux', 'Windows'; or 'MacIntel', 'Linux x86_64', 'Win32'). */
export function platformFromNavigator(nav: NavigatorPlatform): HostPlatform {
  const said =
    `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase();
  if (/\bmac/.test(said)) return 'mac';
  if (/\bwin/.test(said)) return 'windows';
  return 'linux';
}
