// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type ImportDraft, type ImportItem } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  applyBatchSelection,
  describeImportItem,
  groupImportDirectories,
  summariseImportCatalog,
} from '../src/features/library/imports/import-item-meta';

function makeItem(name: string, sizeBytes = 10_000_000, duplicate = false): ImportItem {
  return {
    id: newId<'ImportItem'>(),
    name,
    sizeBytes,
    capturedAt: 1_700_000_000_000,
    thumbnailUrl: null,
    duplicate,
    captureId: null,
    required: true,
    supported: true,
    warning: null,
  };
}

function makeDraft(overrides: Partial<ImportDraft> = {}): ImportDraft {
  return {
    id: newId<'ImportDraft'>(),
    method: 'phone-cable',
    sourceLabel: 'SAMSUNG_Android',
    sourceId: null,
    storage: 'copy',
    destinationLabel: 'Originals',
    selectedIds: [],
    selectAll: false,
    excludedIds: [],
    onlyNew: true,
    allowNetwork: false,
    watch: false,
    recursive: true,
    createdAt: 1,
    updatedAt: 1,
    sessionId: null,
    ...overrides,
  };
}

describe('import choose directory and media organization', () => {
  it('classifies videos, photos, extensions, and explicit or inferred device folders', () => {
    expect(describeImportItem(makeItem('Camera/20261106_142010.mp4'))).toEqual({
      kind: 'video',
      extension: 'MP4',
      directory: 'Camera',
      fileName: '20261106_142010.mp4',
    });
    expect(describeImportItem(makeItem('Screenshots/Screenshot_20261106_120000.jpg'))).toEqual({
      kind: 'image',
      extension: 'JPG',
      directory: 'Screenshots',
      fileName: 'Screenshot_20261106_120000.jpg',
    });
    expect(describeImportItem(makeItem('Screenshot_20261106_120000_Instagram.jpg'))).toEqual({
      kind: 'image',
      extension: 'JPG',
      directory: 'Screenshots',
      fileName: 'Screenshot_20261106_120000_Instagram.jpg',
    });
    expect(describeImportItem(makeItem('VID-20261106-WA0001.mp4'))).toEqual({
      kind: 'video',
      extension: 'MP4',
      directory: 'WhatsApp',
      fileName: 'VID-20261106-WA0001.mp4',
    });
  });

  it('orders primary camera folders ahead of screenshots and summarizes video vs photo counts', () => {
    const camVideo = makeItem('Camera/20261106_142010.mp4', 50_000_000);
    const camPhoto = makeItem('Camera/20261106_142015.jpg', 5_000_000);
    const shot1 = makeItem('Screenshots/Screenshot_1.png', 1_000_000);
    const shot2 = makeItem('Screenshots/Screenshot_2.png', 1_000_000);
    const djiVideo = makeItem('DJI Album/DJI_0001.MP4', 80_000_000);
    const items = [shot1, shot2, camVideo, camPhoto, djiVideo];
    const draft = makeDraft({ selectedIds: [camVideo.id, djiVideo.id] });

    const groups = groupImportDirectories(items, draft);
    expect(groups.map((group) => group.label)).toEqual(['Camera', 'DJI Album', 'Screenshots']);
    expect(groups[0]).toMatchObject({
      label: 'Camera',
      total: 2,
      videos: 1,
      images: 1,
      selected: 1,
    });

    const summary = summariseImportCatalog(items, draft);
    expect(summary).toEqual({
      total: 5,
      videos: 2,
      images: 3,
      selectedTotal: 2,
      selectedVideos: 2,
      selectedImages: 0,
      selectedDirectories: 2,
      selectedBytes: 130_000_000,
    });
  });

  it('applies batch folder selection in both explicit and selectAll modes while respecting onlyNew', () => {
    const freshVideo = makeItem('Camera/clip1.mp4');
    const dupVideo = makeItem('Camera/clip2.mp4', 10_000_000, true);
    const otherPhoto = makeItem('Screenshots/shot1.png');
    const draft = makeDraft({ onlyNew: true });

    const selectedPatch = applyBatchSelection(draft, [freshVideo, dupVideo], true);
    expect(selectedPatch).toEqual({ selectedIds: [freshVideo.id] });

    const allDraft = makeDraft({ selectAll: true, excludedIds: [] });
    const deselectFolderPatch = applyBatchSelection(allDraft, [otherPhoto], false);
    expect(deselectFolderPatch).toEqual({ excludedIds: [otherPhoto.id] });
  });
});
