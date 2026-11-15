// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where one render's files are, agreed between the export pipeline (which
 * writes the checked file into its work folder), `render.overrideQa` (which
 * delivers a needsAttention render after "Export anyway") and the purge job.
 * The file reaches its delivered place only through finalizeRender: the person's exports folder under the
 * render's own name (`renderDelivery`), or `renders/` by id where there is none.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectId, RenderId, RenderRecord } from '@taalcut/core';
import type { RenderFolders } from '../engine/deps';

export type SidecarFormat = 'srt' | 'vtt';

/** `<work>/<renderId>/`: removed when the render ends, kept while it needs attention. */
export function renderWorkDir(folders: Pick<RenderFolders, 'work'>, renderId: RenderId): string {
  return join(folders.work, renderId);
}

/** The muxed, checked file that waits in the work folder for delivery. */
export function renderWorkFile(folders: Pick<RenderFolders, 'work'>, renderId: RenderId): string {
  return join(renderWorkDir(folders, renderId), 'final.mp4');
}

/** A subtitle sidecar beside the work file. */
export function renderWorkSidecar(
  folders: Pick<RenderFolders, 'work'>,
  renderId: RenderId,
  format: SidecarFormat,
): string {
  return join(renderWorkDir(folders, renderId), `final.${format}`);
}

/** `<renders>/<projectId>/<renderId>.<ext>`: the delivered file and its sidecars. */
export function renderDestination(
  folders: Pick<RenderFolders, 'renders'>,
  projectId: ProjectId,
  renderId: RenderId,
  ext: 'mp4' | SidecarFormat = 'mp4',
): string {
  return join(folders.renders, projectId, `${renderId}.${ext}`);
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must lose
const UNSAFE_IN_NAME = /[/\\:\u0000-\u001f\u007f]+/g;
/**
 * The longest stem, in UTF-8 bytes: a file name holds 255 on APFS, NTFS counts differently but allows no more, and
 * the stem needs room for " 999" and an extension. Bytes, not characters: a Hindi title is three bytes a letter.
 */
const STEM_MAX_BYTES = 200;
const SIDECAR_FORMATS: readonly SidecarFormat[] = ['srt', 'vtt'];

/** `text` cut to at most `max` UTF-8 bytes, never inside a character. */
function cutToBytes(text: string, max: number): string {
  let bytes = 0;
  let kept = '';
  for (const character of text) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > max) break;
    kept += character;
  }
  return kept;
}

/**
 * A render's display name as the stem of a file name (FIX-EXPORTNAMES): an aspect ratio keeps its sense ("9:16"
 * is "9x16": a colon can't be in a file name), then no path separators or control characters, no leading dot (the
 * file would be hidden), at most 200 bytes; "Taalcut export" if nothing is left.
 */
export function exportFileStem(name: string): string {
  const plain = name
    .replace(/(\d)\s*:\s*(?=\d)/g, '$1x')
    .replace(UNSAFE_IN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '');
  return cutToBytes(plain, STEM_MAX_BYTES).trim() || 'Taalcut export';
}

/** Where one finished render goes: its file, and each sidecar beside it under the same stem. */
export interface RenderDelivery {
  readonly file: string;
  sidecar(format: SidecarFormat): string;
}

const onDisk = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Where a finished render is delivered, decided once per delivery so the video and its sidecars share a stem.
 * With an exports folder (the app): `<exports>/<the render's name>.mp4`, and when that name is taken, the name
 * with " 2", " 3", … as Finder does, so nothing the person already has is replaced. Without one: the renders
 * folder, by id (`renderDestination`).
 */
export async function renderDelivery(
  folders: Pick<RenderFolders, 'renders' | 'exports'>,
  record: Pick<RenderRecord, 'id' | 'projectId' | 'name'>,
  exists: (path: string) => Promise<boolean> = onDisk,
): Promise<RenderDelivery> {
  const exportsDir = folders.exports;
  if (!exportsDir)
    return {
      file: renderDestination(folders, record.projectId, record.id),
      sidecar: (format) => renderDestination(folders, record.projectId, record.id, format),
    };
  const at = (stem: string): RenderDelivery => ({
    file: join(exportsDir, `${stem}.mp4`),
    sidecar: (format) => join(exportsDir, `${stem}.${format}`),
  });
  const taken = async (delivery: RenderDelivery) => {
    for (const path of [delivery.file, ...SIDECAR_FORMATS.map(delivery.sidecar)])
      if (await exists(path)) return true;
    return false;
  };
  const stem = exportFileStem(record.name);
  for (let copy = 1; copy <= 999; copy += 1) {
    const delivery = at(copy === 1 ? stem : `${stem} ${copy}`);
    if (!(await taken(delivery))) return delivery;
  }
  // A thousand files of one name: the render's id is never taken.
  return at(`${stem} ${record.id}`);
}
