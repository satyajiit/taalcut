// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent process's ExportFileSink (P3-V5): pro exports land whole in `<userData>/exports` under a safe,
 * de-duplicated `<project> – <timeline>.<ext>` and never replace a file; main finds them by name only.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createContainer, ExportFileSinkToken, newId, ok, type ExportFileSink } from '@taalcut/core';
import { exportFilePath, exportsFolder, isExportFileName } from '../src/shared/export-paths';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { UtilityConfigToken } from '../src/shared/tokens';
import {
  createExportFileSink,
  exportFileName,
  exportStem,
  registerExportFileSink,
} from '../src/utility/roots/agent-interchange';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function userData(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'taalcut-exports-'));
  folders.push(folder);
  return folder;
}

const projectId = newId<'Project'>();

async function written(sink: ExportFileSink, baseName: string, text = '{}', extension = '.otio') {
  const result = await sink.write({ projectId, baseName, extension, text });
  if (!result.ok) throw new Error(result.error.code);
  return result.value.fileName;
}

describe('export file sink', () => {
  it('writes <project> – <timeline>.<ext> whole into the exports folder it makes, leaving no temporary file', async () => {
    const folder = exportsFolder(await userData());
    const sink = createExportFileSink({ folder, projectName: () => 'Goa trip' });
    const fileName = await written(sink, 'Variant 1', '{"OTIO_SCHEMA":"Timeline.1"}');
    expect(fileName).toBe('Goa trip – Variant 1.otio');
    expect(await readFile(join(folder, fileName), 'utf8')).toBe('{"OTIO_SCHEMA":"Timeline.1"}');
    expect(await readdir(folder)).toEqual([fileName]);
  });

  it('never replaces a file: the same name again becomes "… 2", then "… 3"', async () => {
    const folder = exportsFolder(await userData());
    const sink = createExportFileSink({ folder });
    expect(await written(sink, 'Cut', 'first', '.fcpxml')).toBe('Cut.fcpxml');
    expect(await written(sink, 'Cut', 'second', '.fcpxml')).toBe('Cut 2.fcpxml');
    expect(await written(sink, 'Cut', 'third', '.fcpxml')).toBe('Cut 3.fcpxml');
    expect(await readFile(join(folder, 'Cut.fcpxml'), 'utf8')).toBe('first');
    expect((await readdir(folder)).sort()).toEqual(['Cut 2.fcpxml', 'Cut 3.fcpxml', 'Cut.fcpxml']);
  });

  it('keeps the timeline name alone when the project is unknown', async () => {
    const sink = createExportFileSink({ folder: exportsFolder(await userData()), projectName: () => null });
    expect(await written(sink, 'Reel')).toBe('Reel.otio');
  });

  it('refuses an extension that is not one plain suffix, and writes nothing', async () => {
    const folder = exportsFolder(await userData());
    const sink = createExportFileSink({ folder });
    for (const extension of ['otio', '.OTIO', '../x', '.a/b']) {
      const result = await sink.write({ projectId, baseName: 'Cut', extension, text: '' });
      expect(!result.ok && result.error.code).toBe('core.validation');
    }
    await expect(readdir(folder)).rejects.toThrow();
  });
});

describe('export file names', () => {
  it('makes plain text safe: no separators, hidden names, control or bidi-override characters', () => {
    expect(exportStem('Trip: day 1/2 \\ final')).toBe('Trip- day 1-2 - final');
    expect(exportStem('..hidden')).toBe('hidden');
    expect(exportStem('a\u0000b\u202ec\n  d.')).toBe('abc d');
    expect(exportStem(' ... ')).toBe('Export');
    expect(exportStem('गोवा यात्रा')).toBe('गोवा यात्रा');
  });

  it("fits APFS's 255-byte limit on a whole grapheme, whatever the copy number", () => {
    const long = 'क्षि'.repeat(80);
    for (const copy of [1, 2, 999]) {
      const name = exportFileName(long, copy, '.fcpxml');
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(255);
      expect(name.endsWith('.fcpxml')).toBe(true);
      const stem = name.replace(/( \d+)?\.fcpxml$/, '');
      expect(long.startsWith(stem)).toBe(true);
      expect(/^\p{M}/u.test(long.slice(stem.length))).toBe(false);
    }
  });

  it('lets main read only names the sink can have written', () => {
    expect(isExportFileName('Goa trip – Variant 1.otio')).toBe(true);
    for (const name of ['', '.', '..', '.abc.tmp', 'a/b.otio', 'a\\b.otio', 'a:b.otio'])
      expect(isExportFileName(name)).toBe(false);
    expect(exportFilePath('/u', 'Cut.otio')).toBe(join('/u', 'exports', 'Cut.otio'));
    expect(exportFilePath('/u', '../Cut.otio')).toBeNull();
  });
});

describe('export file sink registration', () => {
  const config = (folder: string): UtilityConfig => ({
    process: 'agent',
    dbPath: join(folder, 'library.sqlite'),
    userData: folder,
    resourcesPath: folder,
    packaged: false,
    componentManifest: '',
  });

  it('registers a sink on <userData>/exports', async () => {
    const folder = await userData();
    const root = createContainer().value(UtilityConfigToken, config(folder));
    registerExportFileSink(root);
    const fileName = await written(root.resolve(ExportFileSinkToken), 'Reel');
    expect(await readdir(exportsFolder(folder))).toEqual([fileName]);
  });

  it('leaves a sink another root registered first', async () => {
    const own: ExportFileSink = { write: async () => ok({ fileName: 'own.otio' }) };
    const root = createContainer()
      .value(UtilityConfigToken, config(await userData()))
      .value(ExportFileSinkToken, own);
    registerExportFileSink(root);
    expect(root.resolve(ExportFileSinkToken)).toBe(own);
  });
});
