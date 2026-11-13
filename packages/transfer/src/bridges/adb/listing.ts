// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Camera roll over adb sync: DCIM, Pictures and Movies. MediaStore's
 * bucket_display_name replaces the folder album and `datetaken` the date
 * when `content query` works; a query the phone refuses leaves the folder
 * walk as the listing. A folder the phone refuses is skipped; a phone that
 * goes away mid-walk ends the listing with that error, never a partial list.
 *
 * Item ids are the MediaStore `_id`, else the on-device path. They stay
 * inside the bridge and the run file: the renderer and logs only see
 * itemKey (a hash), so no path or file name leaks from here.
 */
import { CancelledError } from '@taalcut/core';
import { AdbSyncError, LinuxFileType, type Adb } from '@yume-chan/adb';
import { fileExtension, sanitiseFileName } from '../../names';
import { type DeviceItem } from '../../usb/bridge';
import { isIgnoredFolder } from '../mtp/codes';
import { runDeviceShell } from './pull';

const STORAGE = ['/sdcard', '/storage/emulated/0'] as const;
const LEAVES = ['DCIM', 'Pictures', 'Movies'] as const;
const MAX_DEPTH = 6;
const PAGE = 500;

/** MediaColumns.DATE_TAKEN is on the files table from Android 10; older phones refuse the column. */
const PROJECTIONS = [
  '_id:_display_name:_size:date_added:datetaken:bucket_display_name:mime_type:width:height:duration',
  '_id:_display_name:_size:date_added:bucket_display_name:mime_type:width:height:duration',
] as const;

/** LIST (sync v1) reports sizes as u32; MediaStore's `_size` is the whole length. */
const U32_RANGE = 2 ** 32;

const MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  dng: 'image/x-adobe-dng',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
};

interface FoundFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
  readonly kind: 'image' | 'video';
}

interface MediaRow {
  readonly id: string;
  readonly name: string;
  readonly size: number | null;
  readonly dateAdded: number | null;
  readonly dateTaken: number | null;
  readonly bucket: string | null;
  readonly mime: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
}

export interface AdbListing {
  readonly items: readonly DeviceItem[];
  /** Item id to the on-device path. Pull has no other handle. */
  readonly paths: ReadonlyMap<string, string>;
}

export async function listMedia(adb: Adb, signal: AbortSignal): Promise<AdbListing> {
  if (signal.aborted) throw CancelledError();
  const found = await walkRoots(adb, signal);
  const rows = await mediaStore(adb, signal);
  const matches = matchRows(found, rows);
  const paths = new Map<string, string>();
  const items = found.map((file) => {
    const item = toItem(file, matches.get(file));
    paths.set(item.id, file.path);
    return item;
  });
  items.sort(byNewest);
  return { items, paths };
}

export async function* pagesOf(
  items: readonly DeviceItem[],
  signal: AbortSignal,
): AsyncGenerator<readonly DeviceItem[]> {
  for (let index = 0; index < items.length; index += PAGE) {
    if (signal.aborted) return;
    yield items.slice(index, index + PAGE);
  }
}

async function walkRoots(adb: Adb, signal: AbortSignal): Promise<FoundFile[]> {
  const sync = await adb.sync();
  try {
    const primary = await collect(sync, STORAGE[0], signal);
    if (primary.length > 0 || signal.aborted) return primary;
    return await collect(sync, STORAGE[1], signal);
  } finally {
    // A socket that will not close belongs to a phone that is gone; the walk's own error says so.
    await sync.dispose().catch(() => undefined);
  }
}

async function collect(
  sync: Awaited<ReturnType<Adb['sync']>>,
  root: string,
  signal: AbortSignal,
): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  const seen = new Set<string>();
  for (const leaf of LEAVES) {
    if (signal.aborted) throw CancelledError();
    await walk(sync, `${root}/${leaf}`, 0, seen, found, signal);
  }
  return found;
}

async function walk(
  sync: Awaited<ReturnType<Adb['sync']>>,
  dir: string,
  depth: number,
  seen: Set<string>,
  found: FoundFile[],
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw CancelledError();
  if (seen.has(dir) || depth > MAX_DEPTH) return;
  seen.add(dir);
  let entries;
  try {
    entries = await sync.readdir(dir);
  } catch (error) {
    // The phone refused this one folder (missing, or not readable over adb): the rest still lists.
    if (error instanceof AdbSyncError) return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.name.length === 0) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.type === LinuxFileType.Directory || entry.type === LinuxFileType.Link) {
      if (isIgnoredFolder(entry.name)) continue;
      await walk(sync, path, depth + 1, seen, found, signal);
      continue;
    }
    if (entry.type !== LinuxFileType.File) continue;
    const kind = kindFor(null, entry.name);
    if (!kind) continue;
    found.push({ path, name: entry.name, size: numberOf(entry.size), mtime: numberOf(entry.mtime), kind });
  }
}

/**
 * The richest projection the phone accepts. A refusal is the phone's answer (permission, an
 * unknown column), so the folder walk stands; a broken connection is thrown, not hidden.
 */
async function mediaStore(adb: Adb, signal: AbortSignal): Promise<readonly MediaRow[]> {
  for (const projection of PROJECTIONS) {
    const ran = await runDeviceShell(adb, queryFor(projection), signal);
    if (ran.aborted) throw CancelledError();
    if (!queryFailed(ran.text, ran.exitCode)) return parseRows(ran.text);
  }
  return [];
}

function queryFor(projection: string): readonly string[] {
  return ['content', 'query', '--uri', 'content://media/external/file', '--projection', projection];
}

function queryFailed(text: string, exitCode: number | null): boolean {
  if (/^Row:\s*\d+/m.test(text)) return false;
  if (exitCode !== null && exitCode !== 0) return true;
  if (text.trim().length === 0) return true;
  return /error|exception|not found|unknown command|permission denial|security exception/i.test(text);
}

function parseRows(text: string): MediaRow[] {
  const rows: MediaRow[] = [];
  for (const line of text.split('\n')) {
    const row = /^Row:\s*\d+\s+(.*)$/.exec(line.trim());
    if (!row?.[1]) continue;
    const fields = new Map<string, string>();
    for (const part of row[1].split(/,\s+/)) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      fields.set(part.slice(0, eq), part.slice(eq + 1));
    }
    const name = fields.get('_display_name');
    const id = fields.get('_id');
    if (!name || !id) continue;
    rows.push({
      id,
      name,
      size: finite(fields.get('_size')),
      dateAdded: finite(fields.get('date_added')),
      dateTaken: positive(fields.get('datetaken')),
      bucket: optionalText(fields.get('bucket_display_name')),
      mime: optionalText(fields.get('mime_type')),
      width: positive(fields.get('width')),
      height: positive(fields.get('height')),
      duration: positive(fields.get('duration')),
    });
  }
  return rows;
}

interface RowMatch {
  readonly row: MediaRow;
  /** True when the row's size is this file's (or its u32 wrap): its `_size` is then the length. */
  readonly sized: boolean;
}

/**
 * Each row serves at most one file. A size match wins; a name-only match needs the name to be
 * unique on both sides, and then only lends metadata: the size stays the one the phone listed.
 */
function matchRows(files: readonly FoundFile[], rows: readonly MediaRow[]): Map<FoundFile, RowMatch> {
  const rowsByName = groupBy(rows, (row) => row.name);
  const filesByName = groupBy(files, (file) => file.name);
  const used = new Set<MediaRow>();
  const matches = new Map<FoundFile, RowMatch>();
  for (const file of files) {
    const named = rowsByName.get(file.name) ?? [];
    const sized = named.find((row) => !used.has(row) && sameSize(row.size, file.size));
    if (sized) {
      used.add(sized);
      matches.set(file, { row: sized, sized: true });
    }
  }
  for (const file of files) {
    if (matches.has(file)) continue;
    const named = rowsByName.get(file.name) ?? [];
    const only = named.length === 1 ? named[0] : undefined;
    if (!only || used.has(only) || (filesByName.get(file.name)?.length ?? 0) !== 1) continue;
    used.add(only);
    matches.set(file, { row: only, sized: false });
  }
  return matches;
}

function sameSize(rowSize: number | null, listed: number): boolean {
  if (rowSize === null) return false;
  return rowSize === listed || (rowSize >= U32_RANGE && rowSize % U32_RANGE === listed);
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const name = key(value);
    const group = groups.get(name);
    if (group) group.push(value);
    else groups.set(name, [value]);
  }
  return groups;
}

/** Capture date first (`datetaken`, ms), then when MediaStore saw it (s), then the file's mtime (s). */
function createdAtOf(file: FoundFile, row: MediaRow | undefined): number | null {
  if (row?.dateTaken != null) return row.dateTaken;
  if (row?.dateAdded != null) return row.dateAdded * 1000;
  return file.mtime > 0 ? file.mtime * 1000 : null;
}

function toItem(file: FoundFile, match: RowMatch | undefined): DeviceItem {
  const row = match?.row;
  const mime = row?.mime ?? mimeFor(file.name);
  const kind = kindFor(mime, file.name) ?? file.kind;
  const folder = folderOf(file.path);
  const leaf = folder ? folder.slice(folder.lastIndexOf('/') + 1) : null;
  const bucket = row?.bucket ? sanitiseFileName(row.bucket) : null;
  const createdAt = createdAtOf(file, row);
  return {
    id: row?.id ?? file.path,
    name: sanitiseFileName(file.name),
    kind,
    sizeBytes: match?.sized && row?.size != null ? row.size : file.size,
    createdAt,
    modifiedAt: file.mtime > 0 ? file.mtime * 1000 : createdAt,
    width: row?.width ?? null,
    height: row?.height ?? null,
    durationMs: kind === 'video' ? (row?.duration ?? null) : null,
    type: mime,
    folder,
    album: bucket ?? (leaf ? sanitiseFileName(leaf) : null),
    flags: {},
    sidecars: [],
    availability: 'unknown',
  };
}

function folderOf(path: string): string | null {
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return null;
  const dir = path.slice(0, slash);
  const marker = ['/DCIM', '/Pictures', '/Movies'].find((part) => dir.includes(part));
  if (!marker) return null;
  const relative = dir.slice(dir.indexOf(marker) + 1);
  const cleaned = relative
    .split('/')
    .map((part) => sanitiseFileName(part))
    .join('/');
  return cleaned.length > 0 ? cleaned : null;
}

function kindFor(mime: string | null, name: string): 'image' | 'video' | null {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  const guessed = MIME[fileExtension(name)];
  if (!guessed) return null;
  return guessed.startsWith('video/') ? 'video' : 'image';
}

function mimeFor(name: string): string | null {
  return MIME[fileExtension(name)] ?? null;
}

function numberOf(value: bigint): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function finite(value: string | undefined): number | null {
  if (!value || value === 'null' || value === 'NULL') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positive(value: string | undefined): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function optionalText(value: string | undefined): string | null {
  if (!value || value === 'null' || value === 'NULL') return null;
  return value;
}

function byNewest(left: DeviceItem, right: DeviceItem): number {
  return (right.createdAt ?? -1) - (left.createdAt ?? -1);
}
