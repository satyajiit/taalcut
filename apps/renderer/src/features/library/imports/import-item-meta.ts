// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportDraft, ImportItem } from '@taalcut/core';
import { itemSelected } from './selection-model';

export type MediaKindFilter = 'all' | 'video' | 'image';

export interface ImportItemMeta {
  readonly kind: 'video' | 'image';
  readonly extension: string;
  readonly directory: string | null;
  readonly fileName: string;
}

export interface DirectoryGroup {
  readonly key: string;
  readonly label: string | null;
  readonly total: number;
  readonly videos: number;
  readonly images: number;
  readonly selected: number;
  readonly selectable: number;
  readonly sizeBytes: number;
}

export interface CatalogSummary {
  readonly total: number;
  readonly videos: number;
  readonly images: number;
  readonly selectedTotal: number;
  readonly selectedVideos: number;
  readonly selectedImages: number;
  readonly selectedDirectories: number;
  readonly selectedBytes: number;
}

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  'avi',
  'mkv',
  'webm',
  'mts',
  'm2ts',
  '3gp',
  '3g2',
  'mpg',
  'mpeg',
  'insv',
  'lrv',
  'mxf',
  'ts',
  'flv',
  'wmv',
]);

/* eslint-disable lingui/no-unlocalized-strings -- canonical device folder names match MTP/PTP album identifiers */
const PRIMARY_FOLDERS = new Set([
  'camera',
  'dcim',
  'dji album',
  'dji',
  'osmo',
  'movies',
  'screen recordings',
  'expert raw',
  'edits',
  'video editor',
  'studio',
  'pictures',
]);

const DEMOTED_FOLDERS = new Set([
  'screenshots',
  'document scans',
  'truecaller images',
]);

function inferDeviceDirectory(fileName: string): string | null {
  if (/^(?:Screenshot_|Screen Shot )/i.test(fileName)) return 'Screenshots';
  if (/^(?:Screen_Recording_|ScreenRecording_|RPReplay_)/i.test(fileName)) return 'Screen recordings';
  if (/^(?:IMG|VID|AUD)-\d{8}-WA/i.test(fileName) || /WhatsApp/i.test(fileName)) return 'WhatsApp';
  if (/^DJI_/i.test(fileName)) return 'DJI Album';
  if (/^FB_IMG_/i.test(fileName)) return 'Facebook';
  if (/^(?:20\d{6}_\d{6}|PXL_\d{8}|IMG_\d{4}|VID_\d{4}|MVI_\d{4})/i.test(fileName)) return 'Camera';
  return null;
}
/* eslint-enable lingui/no-unlocalized-strings */

export function describeImportItem(item: ImportItem): ImportItemMeta {
  const normalized = item.name.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const explicitDir = slash > 0 ? normalized.slice(0, slash).trim() : null;
  const directory = explicitDir || inferDeviceDirectory(fileName);
  const dot = fileName.lastIndexOf('.');
  const rawExt = dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : '';
  const isVideo =
    VIDEO_EXTENSIONS.has(rawExt) || /^(?:VID[_-]|Screen_?Recording_)/i.test(fileName);
  return {
    kind: isVideo ? 'video' : 'image',
    extension: rawExt ? rawExt.toUpperCase() : '',
    directory,
    fileName,
  };
}

function folderRank(label: string | null): number {
  if (!label) return 1;
  const lower = label.toLowerCase();
  if (lower === 'camera' || lower === 'dcim') return 0;
  if (PRIMARY_FOLDERS.has(lower)) return 1;
  if (DEMOTED_FOLDERS.has(lower)) return 3;
  return 2;
}

export const ROOT_DIRECTORY_KEY = '__root__';

export function directoryKeyOf(meta: ImportItemMeta): string {
  return meta.directory ?? ROOT_DIRECTORY_KEY;
}

export function groupImportDirectories(
  items: readonly ImportItem[],
  draft: ImportDraft,
): DirectoryGroup[] {
  const map = new Map<
    string,
    {
      key: string;
      label: string | null;
      total: number;
      videos: number;
      images: number;
      selected: number;
      selectable: number;
      sizeBytes: number;
    }
  >();
  for (const item of items) {
    const meta = describeImportItem(item);
    const key = directoryKeyOf(meta);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: meta.directory,
        total: 0,
        videos: 0,
        images: 0,
        selected: 0,
        selectable: 0,
        sizeBytes: 0,
      };
      map.set(key, group);
    }
    group.total += 1;
    if (meta.kind === 'video') group.videos += 1;
    else group.images += 1;
    if (!draft.onlyNew || !item.duplicate) group.selectable += 1;
    if (itemSelected(draft, item)) group.selected += 1;
    group.sizeBytes += item.sizeBytes ?? 0;
  }
  return [...map.values()].sort((a, b) => {
    const rankDiff = folderRank(a.label) - folderRank(b.label);
    if (rankDiff !== 0) return rankDiff;
    if (b.videos !== a.videos) return b.videos - a.videos;
    if (b.total !== a.total) return b.total - a.total;
    return (a.label ?? '').localeCompare(b.label ?? '');
  });
}

export function summariseImportCatalog(
  items: readonly ImportItem[],
  draft: ImportDraft,
): CatalogSummary {
  let videos = 0;
  let images = 0;
  let selectedTotal = 0;
  let selectedVideos = 0;
  let selectedImages = 0;
  let selectedBytes = 0;
  const selectedDirs = new Set<string>();
  for (const item of items) {
    const meta = describeImportItem(item);
    if (meta.kind === 'video') videos += 1;
    else images += 1;
    if (itemSelected(draft, item)) {
      selectedTotal += 1;
      if (meta.kind === 'video') selectedVideos += 1;
      else selectedImages += 1;
      selectedBytes += item.sizeBytes ?? 0;
      selectedDirs.add(directoryKeyOf(meta));
    }
  }
  return {
    total: items.length,
    videos,
    images,
    selectedTotal,
    selectedVideos,
    selectedImages,
    selectedDirectories: selectedDirs.size,
    selectedBytes,
  };
}

export function applyBatchSelection(
  draft: ImportDraft,
  targetItems: readonly ImportItem[],
  select: boolean,
): Partial<ImportDraft> {
  if (draft.selectAll) {
    const excluded = new Set(draft.excludedIds);
    for (const item of targetItems) {
      if (select) excluded.delete(item.id);
      else excluded.add(item.id);
    }
    return { excludedIds: [...excluded] };
  }
  const selected = new Set(draft.selectedIds);
  for (const item of targetItems) {
    if (select) {
      if (draft.onlyNew && item.duplicate) continue;
      selected.add(item.id);
    } else {
      selected.delete(item.id);
    }
  }
  return { selectedIds: [...selected] };
}
