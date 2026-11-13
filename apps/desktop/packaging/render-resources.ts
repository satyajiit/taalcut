// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * render's caption fonts (OFL, with their licence texts and fonts.lock.json),
 * shipped at Contents/Resources/render/fonts so the render process and
 * app://preview read them (shared/render-paths.ts, renderFontsDir). The
 * headless shell is not here: it is a component (hyperframes-headless-shell).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSet } from 'electron-builder';
import { RENDER_FONTS_RESOURCE } from '../src/shared/render-paths';

export function renderResources(projectDir: string): FileSet[] {
  const fonts = join(projectDir, '..', '..', 'packages', 'render', 'fonts');
  return existsSync(fonts) ? [{ from: fonts, to: RENDER_FONTS_RESOURCE, filter: ['**/*', '!**/.*'] }] : [];
}
