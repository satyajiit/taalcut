// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where render's files live, agreed between main (which serves
 * app://preview) and the render process (which writes them). No Electron
 * and no Node beyond path: main and the utility processes both import it.
 */
import { join } from 'node:path';
import { EXPORTS_ROOTS } from '../platform/exports-roots';
import { hostPlatformName } from '../platform/names';

export interface RenderPaths {
  /** Render's cache: preview sessions, export work folders, conformed segments. */
  readonly cache: string;
  /** app://preview/<token>/… is <preview>/<token>/…. */
  readonly preview: string;
  /** One folder per running export; removed when it finishes or is cancelled. */
  readonly work: string;
  /** Conformed clip segments, content-addressed (LRU-capped by the render process). */
  readonly conform: string;
  /** Renders finished before FIX-EXPORTNAMES: renders/<projectId>/<renderId>.mp4. Still read; nothing new lands here. */
  readonly renders: string;
  /** The person's exports folder (`exportsRoot`): finished renders by name, written only by finalizeRender. */
  readonly exports: string;
}

/** What this module needs of the platform services: each OS's rule for the exports folder. */
export interface ExportsPlatform {
  exportsRoot(userData: string): string;
}

const HOST: ExportsPlatform = { exportsRoot: EXPORTS_ROOTS[hostPlatformName()] };

/**
 * The person's exports folder (FIX-EXPORTNAMES): `~/Movies/Taalcut/Exports` for the app's own data folder, inside
 * `userData` for any other (platform/exports-roots.ts has each OS's rule and says why). Main and every utility
 * process agree because both read it from here.
 */
export function exportsRoot(userData: string, platform: ExportsPlatform = HOST): string {
  return platform.exportsRoot(userData);
}

export function renderPaths(userData: string): RenderPaths {
  const cache = join(userData, 'cache', 'render');
  return {
    cache,
    preview: join(cache, 'preview'),
    work: join(cache, 'work'),
    conform: join(cache, 'conform'),
    renders: join(userData, 'renders'),
    exports: exportsRoot(userData),
  };
}

/** Inside Contents/Resources: the caption fonts packaging copies from packages/render/fonts. */
export const RENDER_FONTS_RESOURCE = join('render', 'fonts');

export interface RenderFontsLocation {
  readonly packaged: boolean;
  /** The app's Resources folder. */
  readonly resourcesPath: string;
  /** apps/desktop in a checkout (main: app.getAppPath(); a utility process: out/utility/../..). */
  readonly desktopDir: string;
}

/** The bundled caption fonts: Resources/render/fonts, or packages/render/fonts in a checkout. */
export function renderFontsDir(location: RenderFontsLocation): string {
  return location.packaged
    ? join(location.resourcesPath, RENDER_FONTS_RESOURCE)
    : join(location.desktopDir, '..', '..', 'packages', 'render', 'fonts');
}
