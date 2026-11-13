// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * window.taalcutFiles: a dropped file's or folder's path on this Mac
 * (Electron's webUtils.getPathForFile), for dropped references and library
 * folders. It only names what the user dropped; it opens nothing. Main
 * checks the path again before it uses it (library.addSource, the
 * reference intake). A File the page made itself has no path: null.
 */

/** The window key the renderer reads (apps/renderer chat/card-actions.ts). */
export const FILES_BRIDGE_KEY = 'taalcutFiles';

export interface FilesBridge {
  pathFor(file: unknown): string | null;
}

/** The part of Electron's webUtils used here. */
export interface PreloadWebUtils {
  getPathForFile(file: File): string;
}

export function createFilesBridge(webUtils: PreloadWebUtils): FilesBridge {
  return {
    pathFor(file) {
      // contextBridge hands the page's File over as this world's File; anything else throws below.
      if (file === null || typeof file !== 'object') return null;
      try {
        const path = webUtils.getPathForFile(file as File);
        return typeof path === 'string' && path !== '' ? path : null;
      } catch {
        return null;
      }
    },
  };
}
