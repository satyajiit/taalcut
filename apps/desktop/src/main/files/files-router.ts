// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.files, served by main: the system's open dialogs as a sheet on
 * the calling window, Finder for a finished render, "Save as…" for one (the
 * save dialog, then a copy of the file and its subtitle sidecars), and the
 * fixed System Settings panes Taalcut sends people to (core's
 * SYSTEM_SETTINGS_URLS), and an allow-listed web page in the browser (core's
 * EXTERNAL_LINK_HOSTS; no other URL is ever opened from here). Electron-free:
 * the dialogs, Finder, the copy and the URL opener are injected, so it is
 * unit-tested.
 *
 * A render's file path never reaches a window: the renderer names the render
 * and main looks the path up in the library. A template file is the same: the
 * window names the template, the agent gives its text (templates.exportDocument).
 * The only path main writes to is the one the person chose in the save dialog.
 * A component's licence notice is the same again: the window names the
 * component, and the jobs process says where its verified notice is.
 */
import { basename, extname, join } from 'node:path';
import {
  filesContract,
  implementContract,
  isExternalLink,
  LOGO_FILE_EXTENSIONS,
  NotFoundError,
  NotImplementedError,
  SYSTEM_SETTINGS_URLS,
  TEMPLATE_FILE_EXTENSION,
  toRpcError,
  toTaalcutError,
  unwrapRpc,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type FILE_PICK_PURPOSES,
  type RenderId,
  type RenderRecord,
  type RenderStore,
  type TemplateDocumentInput,
} from '@taalcut/core';
import { isExportFileName } from '../../shared/export-paths';
import type { RendererContext } from '../rpc/renderer-connections';

export type PickPurpose = (typeof FILE_PICK_PURPOSES)[number];

export interface OpenDialogRequest {
  readonly kind: 'folder' | 'file';
  /** File extensions without the dot; folders take none. */
  readonly extensions?: readonly string[];
  /** The calling window's webContents id: the dialog is a sheet on it. */
  readonly webContentsId: number;
}

export interface SaveDialogRequest {
  /** The suggested file name, with its extension. */
  readonly defaultName: string;
  readonly extensions: readonly string[];
  readonly webContentsId: number;
}

export interface FilesDeps {
  readonly grantCreationDirectory?: (path: string) => Promise<{ accessId: string; label: string }>;
  /** One chosen path, or null when cancelled. */
  readonly open: (request: OpenDialogRequest) => Promise<string | null>;
  /** The path the person chose to save to, or null when cancelled. */
  readonly save: (request: SaveDialogRequest) => Promise<string | null>;
  /** Copies a file, replacing what is there (the save dialog asked first). */
  readonly copy: (from: string, to: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly reveal: (path: string) => void;
  readonly openUrl: (url: string) => Promise<void>;
  /** System Settings is this OS's (PlatformAbilities.systemSettingsPanes); elsewhere its panes don't exist. */
  readonly systemSettingsPanes: boolean;
  readonly renders: () => Pick<RenderStore, 'get'>;
  /** UX2: where a clip's original is on this Mac (its first present location, managed first), or undefined. */
  readonly assetOriginal: (assetId: AssetId) => string | undefined;
  /** Taalcut's exports folder (shared/export-paths.ts), where the agent's sink wrote what saveExportAs copies out. */
  readonly exportsDir: string;
  /** P3-V14: a template's `.taalcut-template` text from the agent (templates.exportDocument). */
  readonly templateDocument: (
    input: TemplateDocumentInput,
  ) => AsyncResult<{ readonly fileName: string; readonly text: string }>;
  /** Writes the text to the path the person chose (the save panel asked before replacing a file). */
  readonly writeText: (path: string, text: string) => Promise<void>;
  /** UX2-DOWNLOADER round 3: where an installed component's licence notice is (the jobs process), or null. */
  readonly installedNotice: (componentId: string) => AsyncResult<string | null>;
  /** Opens a file in its default app; '' when it opened, else why not (Electron's shell.openPath). */
  readonly openPath: (path: string) => Promise<string>;
}

/** What each picker shows: a reel (video) for a reference, audio for music, an image for a brand kit, a template file. */
export const PICK_EXTENSIONS: Readonly<Record<PickPurpose, readonly string[]>> = {
  reference: ['mp4', 'mov', 'm4v', 'webm', 'mkv'],
  music: ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'flac', 'ogg', 'opus'],
  brandImage: LOGO_FILE_EXTENSIONS,
  templateFile: [TEMPLATE_FILE_EXTENSION],
};

// eslint-disable-next-line no-control-regex -- control characters are what this removes
const UNSAFE_IN_NAME = /[/\\:\u0000-\u001f\u007f]+/g;

/**
 * A display name (a render's, a template's) as the stem of a file name: no path separators or control characters,
 * no leading dot (the copy would be hidden), at most `maxLength` characters; "Taalcut export" if nothing is left.
 */
export function plainFileStem(name: string, maxLength: number): string {
  const plain = name.replace(UNSAFE_IN_NAME, ' ').replace(/\s+/g, ' ').trim();
  return (
    plain
      .replace(/^[.\s]+/, '')
      .slice(0, maxLength)
      .trim() || 'Taalcut export'
  );
}

/** A render's display name as a file name (at most 120 characters before `.mp4`). */
export function renderFileName(name: string): string {
  return `${plainFileStem(name, 120)}.mp4`;
}

/** P3-V5: Save as… for a file in Taalcut's exports folder, which the window names (never a path). */
async function saveExportFile(
  deps: Pick<FilesDeps, 'exportsDir' | 'exists' | 'save' | 'copy'>,
  fileName: string,
  webContentsId: number,
): Promise<{ saved: boolean; fileName?: string }> {
  const file = join(deps.exportsDir, fileName);
  if (!isExportFileName(fileName) || !(await deps.exists(file)))
    throw toRpcError(NotFoundError({ entity: 'export file', id: fileName }));
  const ext = extname(fileName).slice(1);
  const chosen = await deps.save({ defaultName: fileName, extensions: ext ? [ext] : [], webContentsId });
  if (!chosen) return { saved: false };
  try {
    await deps.copy(file, chosen);
  } catch (cause) {
    throw toRpcError(toTaalcutError(cause));
  }
  return { saved: true, fileName: basename(chosen) };
}

/** The agent's file name for a template, as a plain name with the template extension. */
export function templateSaveName(fileName: string): string {
  const name = basename(fileName);
  const suffix = `.${TEMPLATE_FILE_EXTENSION}`;
  const stem = name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return `${plainFileStem(stem, 120)}.${TEMPLATE_FILE_EXTENSION}`;
}

/** P3-V14: Save as… for a template file; the window names the template, the agent writes the text, main the file. */
async function saveTemplateFile(
  deps: Pick<FilesDeps, 'templateDocument' | 'save' | 'writeText'>,
  input: TemplateDocumentInput,
  webContentsId: number,
): Promise<{ saved: boolean; fileName?: string }> {
  const document = unwrapRpc(await deps.templateDocument(input));
  const chosen = await deps.save({
    defaultName: templateSaveName(document.fileName),
    extensions: [TEMPLATE_FILE_EXTENSION],
    webContentsId,
  });
  if (!chosen) return { saved: false };
  try {
    await deps.writeText(chosen, document.text);
  } catch (cause) {
    throw toRpcError(toTaalcutError(cause));
  }
  return { saved: true, fileName: basename(chosen) };
}

const withExtension = (path: string, ext: string) =>
  `${path.slice(0, path.length - extname(path).length)}.${ext}`;

/** The render's delivered file, or core.not_found (not finished, needs a look, deleted, or never delivered). */
function deliveredFile(record: RenderRecord, renderId: string): string {
  if (record.status !== 'ready' || record.deletedAt !== null || !record.filePath)
    throw toRpcError(NotFoundError({ entity: 'render file', id: renderId }));
  return record.filePath;
}

export function filesRouter(deps: FilesDeps) {
  const os = implementContract(filesContract).$context<RendererContext>();
  return os.router({
    pickCreationDirectory: os.pickCreationDirectory.handler(async ({ context }) => {
      if (!deps.grantCreationDirectory)
        throw toRpcError(NotImplementedError({ feature: 'creation-directory' }));
      const path = await deps.open({ kind: 'folder', webContentsId: context.webContentsId });
      return path ? deps.grantCreationDirectory(path) : null;
    }),
    pickFolder: os.pickFolder.handler(async ({ context }) => {
      const path = await deps.open({ kind: 'folder', webContentsId: context.webContentsId });
      return path ? { path } : null;
    }),
    pickFile: os.pickFile.handler(async ({ input, context }) => {
      const path = await deps.open({
        kind: 'file',
        extensions: PICK_EXTENSIONS[input.purpose],
        webContentsId: context.webContentsId,
      });
      return path ? { path } : null;
    }),
    revealRender: os.revealRender.handler(async ({ input }) => {
      const record = unwrapRpc(await deps.renders().get(input.renderId as RenderId));
      if (!record.filePath) throw toRpcError(NotFoundError({ entity: 'render file', id: input.renderId }));
      deps.reveal(record.filePath);
    }),
    revealAsset: os.revealAsset.handler(async ({ input }) => {
      const path = deps.assetOriginal(input.assetId);
      if (!path) throw toRpcError(NotFoundError({ entity: 'asset file', id: input.assetId }));
      deps.reveal(path);
    }),
    saveRenderAs: os.saveRenderAs.handler(async ({ input, context }) => {
      const record = unwrapRpc(await deps.renders().get(input.renderId as RenderId));
      const file = deliveredFile(record, input.renderId);
      const chosen = await deps.save({
        defaultName: renderFileName(record.name),
        extensions: ['mp4'],
        webContentsId: context.webContentsId,
      });
      if (!chosen) return { saved: false };
      try {
        await deps.copy(file, chosen);
        for (const format of record.captions.sidecars) {
          const sidecar = withExtension(file, format);
          if (await deps.exists(sidecar)) await deps.copy(sidecar, withExtension(chosen, format));
        }
      } catch (cause) {
        throw toRpcError(toTaalcutError(cause));
      }
      return { saved: true, fileName: basename(chosen) };
    }),
    openSystemSettings: os.openSystemSettings.handler(async ({ input }) => {
      // The window offers these fixes on a Mac alone (packages/ui fixOn); a call from elsewhere opens nothing.
      if (!deps.systemSettingsPanes)
        throw toRpcError(NotImplementedError({ feature: 'system-settings' }, { detail: input.pane }));
      await deps.openUrl(SYSTEM_SETTINGS_URLS[input.pane]);
    }),
    openNotice: os.openNotice.handler(async ({ input }) => {
      const notice = unwrapRpc(await deps.installedNotice(input.componentId));
      if (!notice || !(await deps.exists(notice)))
        throw toRpcError(NotFoundError({ entity: 'notice', id: input.componentId }));
      const failure = await deps.openPath(notice);
      if (failure) throw toRpcError(toTaalcutError(new Error(`couldn't open ${notice}: ${failure}`)));
    }),
    // The contract's schema let only an https page on EXTERNAL_LINK_HOSTS through; checked again before it leaves.
    // The system gets the URL as parsed (WHATWG), never the window's text, so another parser can't read a
    // different host out of it (`https://github.com\\@evil.example/`, tabs, spaces).
    openExternal: os.openExternal.handler(async ({ input }) => {
      if (!isExternalLink(input.url)) throw toRpcError(ValidationError({ field: 'url' }));
      await deps.openUrl(new URL(input.url).href);
    }),
    saveExportAs: os.saveExportAs.handler(({ input, context }) =>
      saveExportFile(deps, input.fileName, context.webContentsId),
    ),
    saveTemplateAs: os.saveTemplateAs.handler(({ input, context }) =>
      saveTemplateFile(deps, input, context.webContentsId),
    ),
  });
}
