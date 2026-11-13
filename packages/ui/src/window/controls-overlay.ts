// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the system draws the window's controls over the page (Chromium's Window Controls Overlay): Electron's
 * `titleBarOverlay` on Linux and Windows (apps/desktop platform/frame.ts). Then the bar draws none of its own and
 * leaves the overlay's corner free (window-bar.tsx); the titlebar-area-* CSS variables say where that is. It goes
 * when the window goes full screen, and comes back after.
 */
import { useEffect, useState } from 'react';

/** The part of navigator.windowControlsOverlay read here (not in TypeScript's DOM types yet). */
export interface ControlsOverlay extends EventTarget {
  readonly visible: boolean;
}

export function controlsOverlay(nav: Navigator = navigator): ControlsOverlay | null {
  return (nav as Navigator & { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay ?? null;
}

/** True while the system's controls are drawn over the page. */
export function useWindowControlsOverlay(overlay: ControlsOverlay | null = controlsOverlay()): boolean {
  const [visible, setVisible] = useState(() => overlay?.visible ?? false);
  useEffect(() => {
    if (!overlay) return;
    const update = () => setVisible(overlay.visible);
    update();
    overlay.addEventListener('geometrychange', update);
    return () => overlay.removeEventListener('geometrychange', update);
  }, [overlay]);
  return visible;
}
