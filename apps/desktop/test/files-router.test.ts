// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.files in main: the open panel as a sheet on the caller's
 * window, Finder for a finished render (its path never leaves main), "Save
 * as…" (the save panel, then a copy of the file and its sidecars), and only
 * the fixed System Settings URLs and allow-listed web pages.
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  err,
  filesContract,
  newId,
  NotFoundError,
  ok,
  serveRpc,
  SYSTEM_SETTINGS_URLS,
  type RenderRecord,
  type Result,
  type TemplateDocumentInput,
} from '@taalcut/core';
import {
  filesRouter,
  PICK_EXTENSIONS,
  renderFileName,
  templateSaveName,
  type FilesDeps,
  type OpenDialogRequest,
  type SaveDialogRequest,
} from '../src/main/files/files-router';

function serve(deps: FilesDeps, webContentsId = 7): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(filesRouter(deps), port1, { context: { caller: 'renderer' as const, webContentsId } });
  return port2;
}

const TEMPLATE_TEXT = '{"format":"taalcut-template","version":0}';

function fake(
  answer: string | null,
  record?: Partial<RenderRecord>,
  files: readonly string[] = [],
  document: Result<{ fileName: string; text: string }> = ok({
    fileName: 'goa-trip.taalcut-template',
    text: TEMPLATE_TEXT,
  }),
) {
  const opened: OpenDialogRequest[] = [];
  const saving: SaveDialogRequest[] = [];
  const copied: [string, string][] = [];
  const revealed: string[] = [];
  const urls: string[] = [];
  const documents: TemplateDocumentInput[] = [];
  const written: [string, string][] = [];
  const notices: string[] = [];
  const deps: FilesDeps = {
    open: async (request) => {
      opened.push(request);
      return answer;
    },
    save: async (request) => {
      saving.push(request);
      return answer;
    },
    copy: async (from, to) => {
      if (to.includes('read-only')) throw Object.assign(new Error('EACCES'), { name: 'Error' });
      copied.push([from, to]);
    },
    exists: async (path) => files.includes(path),
    reveal: (path) => revealed.push(path),
    openUrl: async (url) => {
      urls.push(url);
    },
    systemSettingsPanes: true,
    renders: () => ({
      get: async (id) =>
        record ? ok({ ...(record as RenderRecord), id }) : err(NotFoundError({ entity: 'render', id })),
    }),
    assetOriginal: () => answer ?? undefined,
    exportsDir: '/data/exports',
    templateDocument: async (input) => {
      documents.push(input);
      return document;
    },
    writeText: async (path, text) => {
      if (path.includes('read-only')) throw Object.assign(new Error('EACCES'), { name: 'Error' });
      written.push([path, text]);
    },
    installedNotice: async (componentId) =>
      componentId === 'jobs-down'
        ? err(NotFoundError({ entity: 'process', id: 'jobs' }))
        : ok(
            componentId === 'whisper-tiny' || componentId === 'gone'
              ? `/c/${componentId}/TAALCUT-NOTICE.txt`
              : null,
          ),
    openPath: async (path) => {
      notices.push(path);
      return '';
    },
  };
  return { deps, opened, saving, copied, revealed, urls, documents, written, notices };
}

const READY: Partial<RenderRecord> = {
  status: 'ready',
  deletedAt: null,
  name: 'Goa / sunset: take 2',
  filePath: '/lib/renders/p/r.mp4',
  captions: { burnIn: true, sidecars: ['srt', 'vtt'] },
};

describe('files router', () => {
  it('opens a folder panel on the calling window and returns the path, or null when cancelled', async () => {
    const chosen = fake('/Users/me/Trip');
    const client = connectRpc(filesContract, serve(chosen.deps, 42), { peer: 'main' }).client;
    expect(await client.pickFolder()).toEqual({ path: '/Users/me/Trip' });
    expect(chosen.opened).toEqual([{ kind: 'folder', webContentsId: 42 }]);

    const cancelled = fake(null);
    const other = connectRpc(filesContract, serve(cancelled.deps), { peer: 'main' }).client;
    expect(await other.pickFolder()).toBeNull();
  });

  it('filters a file panel by purpose', async () => {
    const chosen = fake('/Users/me/reel.mp4');
    const client = connectRpc(filesContract, serve(chosen.deps), { peer: 'main' }).client;
    expect(await client.pickFile({ purpose: 'reference' })).toEqual({ path: '/Users/me/reel.mp4' });
    await client.pickFile({ purpose: 'music' });
    await client.pickFile({ purpose: 'brandImage' });
    await client.pickFile({ purpose: 'templateFile' });
    expect(chosen.opened.map((r) => r.extensions)).toEqual([
      PICK_EXTENSIONS.reference,
      PICK_EXTENSIONS.music,
      PICK_EXTENSIONS.brandImage,
      ['taalcut-template'],
    ]);
  });

  it("reveals a render's file in Finder by its id", async () => {
    const done = fake(null, { filePath: '/Users/me/Movies/Taalcut/trip.mp4' });
    const client = connectRpc(filesContract, serve(done.deps), { peer: 'main' }).client;
    await client.revealRender({ renderId: newId<'Render'>() });
    expect(done.revealed).toEqual(['/Users/me/Movies/Taalcut/trip.mp4']);

    const unfinished = fake(null, { filePath: null });
    const again = connectRpc(filesContract, serve(unfinished.deps), { peer: 'main' }).client;
    await expect(again.revealRender({ renderId: newId<'Render'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    expect(unfinished.revealed).toEqual([]);
  });

  it("reveals a clip's original in Finder, and says not found when no copy is present", async () => {
    const present = fake('/Volumes/Trips/Goa/IMG_0042.MOV');
    const client = connectRpc(filesContract, serve(present.deps), { peer: 'main' }).client;
    await client.revealAsset({ assetId: newId<'Asset'>() });
    expect(present.revealed).toEqual(['/Volumes/Trips/Goa/IMG_0042.MOV']);

    const away = fake(null);
    const again = connectRpc(filesContract, serve(away.deps), { peer: 'main' }).client;
    await expect(again.revealAsset({ assetId: newId<'Asset'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    expect(away.revealed).toEqual([]);
  });

  it('saves a copy of a finished render, and its subtitles, where the person chose', async () => {
    const done = fake('/Users/me/Desktop/Goa.mp4', READY, ['/lib/renders/p/r.srt']);
    const client = connectRpc(filesContract, serve(done.deps, 9), { peer: 'main' }).client;
    expect(await client.saveRenderAs({ renderId: newId<'Render'>() })).toEqual({
      saved: true,
      fileName: 'Goa.mp4',
    });
    expect(done.saving).toEqual([
      { defaultName: 'Goa sunset take 2.mp4', extensions: ['mp4'], webContentsId: 9 },
    ]);
    // The .vtt was never written, so only the .srt goes along.
    expect(done.copied).toEqual([
      ['/lib/renders/p/r.mp4', '/Users/me/Desktop/Goa.mp4'],
      ['/lib/renders/p/r.srt', '/Users/me/Desktop/Goa.srt'],
    ]);

    const cancelled = fake(null, READY);
    const other = connectRpc(filesContract, serve(cancelled.deps), { peer: 'main' }).client;
    expect(await other.saveRenderAs({ renderId: newId<'Render'>() })).toEqual({ saved: false });
    expect(cancelled.copied).toEqual([]);

    const failing = fake('/Volumes/read-only/Goa.mp4', READY);
    const third = connectRpc(filesContract, serve(failing.deps), { peer: 'main' }).client;
    await expect(third.saveRenderAs({ renderId: newId<'Render'>() })).rejects.toMatchObject({
      data: { code: 'core.unknown' },
    });
  });

  it('asks nothing for a render without a finished file', async () => {
    for (const record of [
      { ...READY, status: 'rendering' as const, filePath: null },
      { ...READY, status: 'needsAttention' as const },
      { ...READY, deletedAt: 5 },
    ]) {
      const early = fake('/Users/me/Desktop/Goa.mp4', record);
      const client = connectRpc(filesContract, serve(early.deps), { peer: 'main' }).client;
      await expect(client.saveRenderAs({ renderId: newId<'Render'>() })).rejects.toMatchObject({
        data: { code: 'core.not_found' },
      });
      expect(early.saving).toEqual([]);
    }
    const missing = fake('/Users/me/Desktop/Goa.mp4');
    const client = connectRpc(filesContract, serve(missing.deps), { peer: 'main' }).client;
    await expect(client.saveRenderAs({ renderId: newId<'Render'>() })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });

  it('saves a copy of a pro export from the exports folder, naming only the file', async () => {
    const done = fake('/Users/me/Desktop/Goa.otio', undefined, ['/data/exports/Goa – Main.otio']);
    const client = connectRpc(filesContract, serve(done.deps, 4), { peer: 'main' }).client;
    expect(await client.saveExportAs({ fileName: 'Goa – Main.otio' })).toEqual({
      saved: true,
      fileName: 'Goa.otio',
    });
    expect(done.saving).toEqual([{ defaultName: 'Goa – Main.otio', extensions: ['otio'], webContentsId: 4 }]);
    expect(done.copied).toEqual([['/data/exports/Goa – Main.otio', '/Users/me/Desktop/Goa.otio']]);
    // A file that isn't there, or a hidden or dot name, is not found and no panel opens.
    for (const fileName of ['Other.otio', '..', '.hidden.otio']) {
      await expect(client.saveExportAs({ fileName })).rejects.toMatchObject({
        data: { code: 'core.not_found' },
      });
    }
    // Separators are refused by the contract before main sees them.
    await expect(client.saveExportAs({ fileName: '../x.otio' })).rejects.toBeTruthy();
    expect(done.saving).toHaveLength(1);
  });

  it("saves a template's file where the person chose, with the text the agent gave", async () => {
    const done = fake('/Users/me/Desktop/Goa trip.taalcut-template');
    const client = connectRpc(filesContract, serve(done.deps, 3), { peer: 'main' }).client;
    const templateId = newId<'Template'>();
    expect(await client.saveTemplateAs({ templateId, version: 2, includeStyle: true })).toEqual({
      saved: true,
      fileName: 'Goa trip.taalcut-template',
    });
    expect(done.documents).toEqual([{ templateId, version: 2, includeStyle: true }]);
    expect(done.saving).toEqual([
      { defaultName: 'goa-trip.taalcut-template', extensions: ['taalcut-template'], webContentsId: 3 },
    ]);
    expect(done.written).toEqual([['/Users/me/Desktop/Goa trip.taalcut-template', TEMPLATE_TEXT]]);
    // The style stays out unless asked (the contract's default).
    await client.saveTemplateAs({ templateId });
    expect(done.documents[1]).toEqual({ templateId, includeStyle: false });
  });

  it('writes nothing when the template save is cancelled or fails', async () => {
    const cancelled = fake(null);
    const client = connectRpc(filesContract, serve(cancelled.deps), { peer: 'main' }).client;
    expect(await client.saveTemplateAs({ templateId: newId<'Template'>() })).toEqual({ saved: false });
    expect(cancelled.written).toEqual([]);

    const templateId = newId<'Template'>();
    const gone = fake(
      '/Users/me/x.taalcut-template',
      undefined,
      [],
      err(NotFoundError({ entity: 'template', id: templateId })),
    );
    const other = connectRpc(filesContract, serve(gone.deps), { peer: 'main' }).client;
    await expect(other.saveTemplateAs({ templateId })).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
    expect(gone.saving).toEqual([]);

    const locked = fake('/Volumes/read-only/x.taalcut-template');
    const third = connectRpc(filesContract, serve(locked.deps), { peer: 'main' }).client;
    await expect(third.saveTemplateAs({ templateId })).rejects.toMatchObject({
      data: { code: 'core.unknown' },
    });
    expect(locked.written).toEqual([]);
  });

  it("turns the agent's template file name into a plain one with the template extension", () => {
    expect(templateSaveName('goa-trip.taalcut-template')).toBe('goa-trip.taalcut-template');
    expect(templateSaveName('Goa.TAALCUT-TEMPLATE')).toBe('Goa.taalcut-template');
    expect(templateSaveName('../../etc/passwd')).toBe('passwd.taalcut-template');
    expect(templateSaveName('.hidden')).toBe('hidden.taalcut-template');
    expect(templateSaveName('')).toBe('Taalcut export.taalcut-template');
  });

  it('turns a render name into a plain file name', () => {
    expect(renderFileName('Trip to Goa – Reels')).toBe('Trip to Goa – Reels.mp4');
    expect(renderFileName('../..//x\u0007y')).toBe('x y.mp4');
    expect(renderFileName('  ')).toBe('Taalcut export.mp4');
    expect(renderFileName('a'.repeat(300))).toHaveLength(124);
  });

  it('opens an installed component’s licence notice by its id, never a path from the window', async () => {
    const mac = fake(null, undefined, ['/c/whisper-tiny/TAALCUT-NOTICE.txt']);
    const client = connectRpc(filesContract, serve(mac.deps), { peer: 'main' }).client;
    await client.openNotice({ componentId: 'whisper-tiny' });
    expect(mac.notices).toEqual(['/c/whisper-tiny/TAALCUT-NOTICE.txt']);
    // Not installed, or its notice deleted by hand: not found, and nothing opens.
    for (const componentId of ['qwen', 'gone'])
      await expect(client.openNotice({ componentId })).rejects.toMatchObject({
        data: { code: 'core.not_found' },
      });
    // The jobs process's own error, as it said it.
    await expect(client.openNotice({ componentId: 'jobs-down' })).rejects.toMatchObject({
      data: { code: 'core.not_found', params: { entity: 'process' } },
    });
    expect(mac.notices).toHaveLength(1);
  });

  it('opens only the fixed System Settings pane', async () => {
    const settings = fake(null);
    const client = connectRpc(filesContract, serve(settings.deps), { peer: 'main' }).client;
    await client.openSystemSettings({ pane: 'filesAndFolders' });
    expect(settings.urls).toEqual([SYSTEM_SETTINGS_URLS.filesAndFolders]);
    // Anything else is refused by the contract before main sees it.
    await expect(
      client.openSystemSettings({ pane: 'https://example.com' as 'filesAndFolders' }),
    ).rejects.toBeTruthy();
    expect(settings.urls).toHaveLength(1);
  });

  it('opens no System Settings pane off a Mac, where there are none (UX3-MAC)', async () => {
    const settings = fake(null);
    const client = connectRpc(filesContract, serve({ ...settings.deps, systemSettingsPanes: false }), {
      peer: 'main',
    }).client;
    await expect(client.openSystemSettings({ pane: 'storage' })).rejects.toMatchObject({
      data: { code: 'core.not_implemented' },
    });
    expect(settings.urls).toEqual([]);
  });

  it('opens only an https page on the allow-list in the browser', async () => {
    const links = fake(null);
    const client = connectRpc(filesContract, serve(links.deps), { peer: 'main' }).client;
    const billing = 'https://platform.openai.com/settings/organization/billing';
    await client.openExternal({ url: billing });
    expect(links.urls).toEqual([billing]);
    for (const url of [
      'http://platform.openai.com/settings',
      'https://example.com/',
      'https://platform.openai.com.example.com/',
      'https://someone:secret@github.com/',
      'https://github.com:8443/',
      'file:///etc/passwd',
      'x-apple.systempreferences:com.apple.preference.security',
    ])
      await expect(client.openExternal({ url }), url).rejects.toBeTruthy();
    expect(links.urls).toEqual([billing]);
  });

  it('hands the system the parsed URL, not the text it was given', async () => {
    const links = fake(null);
    const client = connectRpc(filesContract, serve(links.deps), { peer: 'main' }).client;
    await client.openExternal({ url: 'https://github.com\\@evil.example/' });
    await client.openExternal({ url: 'https://GitHub.com/taalcut/taalcut issues' });
    expect(links.urls).toEqual([
      'https://github.com/@evil.example/',
      'https://github.com/taalcut/taalcut%20issues',
    ]);
  });
});
