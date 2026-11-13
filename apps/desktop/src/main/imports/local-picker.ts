// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, NotFoundError, type AsyncResult } from '@taalcut/core';
import type { ImportCreateInput } from '@taalcut/library';
import { BrowserWindow, dialog } from 'electron';
import type { MountedMediaPort } from '../../platform/mounted-media';

/** Called from createDraft only, never from a route loader or a preflight query. */
export function localImportPicker(mounted: MountedMediaPort) {
  return async (input: ImportCreateInput): AsyncResult<readonly string[]> => {
    if (input.deviceId) {
      const listing = await mounted.list();
      if (!listing.ok) return listing;
      const source = listing.value.find((candidate) => candidate.id === input.deviceId);
      return source ? ok([source.path]) : err(NotFoundError({ entity: 'mounted media', id: input.deviceId }));
    }
    const folder = input.method !== 'files';
    const request: Electron.OpenDialogOptions = {
      properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      ...(!folder
        ? {
            filters: [
              {
                name: 'Media',
                extensions: [
                  'mp4',
                  'mov',
                  'm4v',
                  'mkv',
                  'webm',
                  'avi',
                  'mxf',
                  'mts',
                  'm2ts',
                  'jpg',
                  'jpeg',
                  'png',
                  'heic',
                  'heif',
                  'dng',
                  'wav',
                  'mp3',
                  'm4a',
                  'insv',
                  'insp',
                ],
              },
            ],
          }
        : {}),
    };
    const parent = BrowserWindow.getFocusedWindow();
    const chosen = parent
      ? await dialog.showOpenDialog(parent, request)
      : await dialog.showOpenDialog(request);
    return ok(chosen.canceled ? [] : chosen.filePaths);
  };
}
