// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two window frames (DESIGN.md, "Window"). The renderer draws the window bar in both; what differs is who
 * draws the window's controls.
 *
 * - macOS: the title bar is hidden but the frame stays (rounded corners, shadow, resize edges, Spaces and full
 *   screen are native), and the system traffic lights are hidden too: the bar draws its own. Full screen can
 *   bring the lights back, so they are hidden again on the way in and out.
 * - Linux and Windows, one path: the title bar is hidden and the system draws its minimise, maximise and close
 *   buttons over the bar's right end (Chromium's window controls overlay), in the theme's colours. The bar sees
 *   the overlay (navigator.windowControlsOverlay, the titlebar-area-* CSS variables), leaves room for it and
 *   draws no controls of its own. The menu bar stays hidden; the menu's accelerators still work.
 */
import type { ChromeColours, WindowChrome } from './types';

/**
 * The overlay's height: the bar's 52 px (--spacing-toolbar) less its 1 px hairline, which the bar carries on under
 * the overlay so it runs the window's whole width.
 */
export const OVERLAY_HEIGHT = 51;

export const hiddenLightsFrame: WindowChrome = {
  options: () => ({ titleBarStyle: 'hidden' }),
  attach(win) {
    const hideLights = (): void => win.setWindowButtonVisibility(false);
    hideLights();
    win.on('enter-full-screen', hideLights);
    win.on('leave-full-screen', hideLights);
  },
  recolour: () => undefined,
};

const overlayColours = (colours: ChromeColours) => ({
  color: colours.background,
  symbolColor: colours.symbols,
});

export const controlsOverlayFrame: WindowChrome = {
  options: (colours) => ({
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColours(colours), height: OVERLAY_HEIGHT },
    // Alt doesn't bring a menu bar over the window bar.
    autoHideMenuBar: false,
  }),
  attach: (win) => win.setMenuBarVisibility(false),
  recolour: (win, colours) => win.setTitleBarOverlay(overlayColours(colours)),
};
