// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ExportFileSink in the agent process (P3-V5): `timeline.exportInterchange` hands it an `.otio` or
 * `.fcpxml` document and it lands in Taalcut's exports folder as `<project> – <timeline>.<ext>`, made safe and
 * de-duplicated (`… 2.otio`), never overwriting a file already there. The text goes to a hidden temporary file
 * first, flushed, then hard-linked to its name (the link fails when the name is taken), so the named file is
 * always whole. Main's `files.saveExportAs({ fileName })` copies it from `exportsFolder(userData)`.
 */
import { randomUUID } from 'node:crypto';
import { link, mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConflictError,
  err,
  ExportFileSinkToken,
  ok,
  toTaalcutError,
  ValidationError,
  type Container,
  type ExportFileSink,
  type ProjectId,
} from '@taalcut/core';
import { createProjectRepository } from '@taalcut/library';
import { exportsFolder } from '../../shared/export-paths';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';

/** APFS's limit for one name, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255;
/** `… 2` up to `… 999`, then core.conflict. */
const MAX_COPIES = 999;
const EXTENSION = /^\.[a-z0-9]+$/;
const FALLBACK_STEM = 'Export';

export interface ExportFileSinkDeps {
  /** Taalcut's exports folder; made on the first write. */
  readonly folder: string;
  /** The project's name, for `<project> – <timeline>`; null (or absent) keeps the timeline's name alone. */
  readonly projectName?: (projectId: ProjectId) => string | null;
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** The longest whole-grapheme prefix of `text` that fits in `limit` bytes. */
function fitBytes(text: string, limit: number): string {
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (bytes(out + segment) > limit) break;
    out += segment;
  }
  return out;
}

/**
 * Plain text as a file name stem: no control or bidi-override characters, no separators, no leading dots (a
 * hidden file) or trailing dots and spaces, one space between words.
 */
export function exportStem(text: string): string {
  const cleaned = text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .replace(/[/\\:]/g, '-')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  return cleaned.length > 0 ? cleaned : FALLBACK_STEM;
}

/** The n-th candidate name (1: the plain one), within APFS's limit whatever the suffix. */
export function exportFileName(stem: string, copy: number, extension: string): string {
  const reserve = bytes(` ${MAX_COPIES}`) + bytes(extension);
  const fitted = fitBytes(stem, MAX_NAME_BYTES - reserve).replace(/[. ]+$/, '') || FALLBACK_STEM;
  return `${copy === 1 ? fitted : `${fitted} ${copy}`}${extension}`;
}

const nameTaken = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'EEXIST';

/** Writes `text` to a hidden temporary file in `folder` and flushes it to disk. */
async function writeTemporary(folder: string, text: string | Uint8Array): Promise<string> {
  const temporary = join(folder, `.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporary;
}

/** Links `temporary` under the first free name for `stem`; null when all MAX_COPIES names are taken. */
async function linkFreeName(
  folder: string,
  temporary: string,
  stem: string,
  extension: string,
): Promise<string | null> {
  for (let copy = 1; copy <= MAX_COPIES; copy++) {
    const fileName = exportFileName(stem, copy, extension);
    try {
      await link(temporary, join(folder, fileName));
      return fileName;
    } catch (cause) {
      if (!nameTaken(cause)) throw cause;
    }
  }
  return null;
}

type ExportFileInput = Omit<Parameters<ExportFileSink['write']>[0], 'text'> & {
  readonly text: string | Uint8Array;
};

/** Writes one export: the whole text under a free name in the folder, or an error value. */
async function writeExportFile(
  deps: ExportFileSinkDeps,
  input: ExportFileInput,
): ReturnType<ExportFileSink['write']> {
  if (!EXTENSION.test(input.extension)) return err(ValidationError({ field: 'extension' }));
  const project = deps.projectName?.(input.projectId) ?? null;
  const stem = exportStem(project ? `${project} – ${input.baseName}` : input.baseName);
  try {
    await mkdir(deps.folder, { recursive: true });
    const temporary = await writeTemporary(deps.folder, input.text);
    try {
      const fileName = await linkFreeName(deps.folder, temporary, stem, input.extension);
      if (fileName) return ok({ fileName });
      return err(ConflictError({ entity: 'exportFile' }, { detail: `${MAX_COPIES} files share this name` }));
    } finally {
      await rm(temporary, { force: true });
    }
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

export function createExportFileSink(deps: ExportFileSinkDeps): ExportFileSink {
  return {
    write: (input) => writeExportFile(deps, input),
    writeBytes: ({ bytes, ...input }) => writeExportFile(deps, { ...input, text: bytes }),
  };
}

/** A project's name from the library's catalogue; null when it is gone. */
function projectNames(container: Container) {
  return (projectId: ProjectId): string | null => {
    const found = createProjectRepository(container.resolve(LibraryDatabaseToken)).get(projectId);
    return found.ok ? found.value.name : null;
  };
}

/** Registers the sink under core's ExportFileSinkToken, unless another root registered one first. */
export function registerExportFileSink(container: Container): void {
  if (container.has(ExportFileSinkToken)) return;
  container.factory(
    ExportFileSinkToken,
    ({ config }) =>
      createExportFileSink({
        folder: exportsFolder(config.userData),
        ...(container.has(LibraryDatabaseToken) ? { projectName: projectNames(container) } : {}),
      }),
    { deps: { config: UtilityConfigToken } },
  );
}
