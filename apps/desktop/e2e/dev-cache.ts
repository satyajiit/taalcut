// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The e2e's development cache, Taalcut-dev, in this OS's cache folder (LNX1-PKG): ~/Library/Caches on a Mac, else
 * $XDG_CACHE_HOME (~/.cache; a relative one is ignored, as the XDG spec says). The component archives, the generated
 * libraries and the VideoToolbox stall reports live under it. Each has its own variable that overrides it.
 */
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function devCache(...parts: string[]): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const caches =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Caches')
      : xdg && isAbsolute(xdg)
        ? xdg
        : join(homedir(), '.cache');
  return join(caches, 'Taalcut-dev', ...parts);
}
