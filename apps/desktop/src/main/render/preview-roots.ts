// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The folders app://preview may serve from, in this app: the render cache
 * (preview sessions, conformed and QA frames), the renders folder and the
 * bundled caption fonts, all from render-paths.ts so the render process
 * writes where main reads; and (HFW1-WS) the projects' workspace blobs,
 * from the library's own `workspacesRoot`, read-only.
 */
import { app } from 'electron';
import { workspacesRoot } from '@taalcut/library';
import { mediaCacheRoot } from '../../shared/media-cache';
import { renderFontsDir, renderPaths } from '../../shared/render-paths';
import type { PreviewRoots } from './preview-resolve';

let roots: PreviewRoots | undefined;

/** Read on the first preview request (after ready, so userData honours --user-data-dir). */
export function desktopPreviewRoots(): PreviewRoots {
  if (roots) return roots;
  const userData = app.getPath('userData');
  const paths = renderPaths(userData);
  const fonts = renderFontsDir({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    desktopDir: app.getAppPath(),
  });
  roots = {
    preview: paths.preview,
    allowed: [paths.cache, paths.renders, fonts, mediaCacheRoot(userData)],
    workspaces: workspacesRoot(userData),
  };
  return roots;
}
