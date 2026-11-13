// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * filesRouter over Electron: the open and save panels as sheets on the window
 * that asked, Finder's reveal, a copy-on-write copy where the volume allows it
 * (APFS clones a render in no time), and shell.openExternal for the fixed
 * System Settings URLs only (files-router.ts picks them; nothing else is
 * passed in); shell.openPath for a component's licence notice, at the path
 * the jobs process gives.
 */
import { constants } from 'node:fs';
import { access, copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  webContents,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { callRpc, ok, type Container } from '@taalcut/core';
import { createRenderStore, presentOriginal } from '@taalcut/library';
import { exportsFolder } from '../../shared/export-paths';
import { PlatformServicesToken } from '../../platform';
import { LibraryDatabaseToken } from '../../shared/tokens';
import type { UtilityHost } from '../rpc/utility-host';
import { filesRouter, type OpenDialogRequest, type SaveDialogRequest } from './files-router';
import { grantCreationDirectory } from '../../shared/creation-grants';

function windowFor(webContentsId: number): BrowserWindow | null {
  const contents = webContents.fromId(webContentsId);
  return contents ? BrowserWindow.fromWebContents(contents) : null;
}

async function open(request: OpenDialogRequest): Promise<string | null> {
  const window = windowFor(request.webContentsId);
  const options: OpenDialogOptions = {
    properties: request.kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile'],
    // One filter: macOS shows no filter menu, so the name is never seen.
    ...(request.extensions ? { filters: [{ name: '', extensions: [...request.extensions] }] } : {}),
  };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function save(request: SaveDialogRequest): Promise<string | null> {
  const window = windowFor(request.webContentsId);
  const options: SaveDialogOptions = {
    defaultPath: join(app.getPath('videos'), request.defaultName),
    filters: [{ name: '', extensions: [...request.extensions] }],
    properties: ['createDirectory'],
  };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}

export function electronFilesRouter(container: Container, host: Pick<UtilityHost, 'client'>) {
  return filesRouter({
    grantCreationDirectory: (path) => grantCreationDirectory(app.getPath('userData'), path),
    open,
    save,
    copy: (from, to) => copyFile(from, to, constants.COPYFILE_FICLONE),
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    reveal: (path) => shell.showItemInFolder(path),
    openUrl: (url) => shell.openExternal(url),
    systemSettingsPanes: container.resolve(PlatformServicesToken).abilities.systemSettingsPanes,
    renders: () => createRenderStore(container.resolve(LibraryDatabaseToken)),
    assetOriginal: (assetId) => presentOriginal(container.resolve(LibraryDatabaseToken), assetId)?.path,
    exportsDir: exportsFolder(app.getPath('userData')),
    templateDocument: (input) => callRpc(host.client('agent').templates.exportDocument(input)),
    writeText: (path, text) => writeFile(path, text, 'utf8'),
    installedNotice: async (componentId) => {
      const installed = await callRpc(host.client('jobs').components.get({ id: componentId }));
      return installed.ok ? ok(installed.value?.notice ?? null) : installed;
    },
    openPath: (path) => shell.openPath(path),
  });
}
