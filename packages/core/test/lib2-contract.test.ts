// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  IMPORT_COMMANDS,
  IMPORT_METHODS,
  importCommandPayloads,
  importItemOutcomeSchema,
  importMethodSchema,
  newId,
  stagedImportSchema,
} from '../src/index';

describe('LIB2 contracts', () => {
  it('validates every route method and refuses paths as methods', () => {
    for (const method of IMPORT_METHODS) expect(importMethodSchema.parse(method)).toBe(method);
    expect(importMethodSchema.safeParse('/Volumes/Camera').success).toBe(false);
    expect(importCommandPayloads[IMPORT_COMMANDS.start].safeParse({ draftId: '/tmp/file' }).success).toBe(
      false,
    );
  });
  it('keeps an explicit all selection compact', () => {
    const payload = importCommandPayloads[IMPORT_COMMANDS.updateDraft].parse({
      draftId: newId<'ImportDraft'>(),
      selectAll: true,
      excludedIds: ['one'],
      onlyNew: true,
    });
    expect(payload.selectAll).toBe(true);
    expect(payload.selectedIds).toBeUndefined();
  });
  it('does not claim an archived original is a playable asset', () => {
    const receipt = {
      itemId: 'one',
      name: 'capture.insv',
      state: 'archived',
      receivedBytes: 40,
      error: null,
      result: { kind: 'archived', captureId: newId<'CaptureGroup'>(), complete: false },
    };
    expect(importItemOutcomeSchema.parse(receipt).result?.kind).toBe('archived');
    expect(
      importItemOutcomeSchema.safeParse({
        ...receipt,
        result: { kind: 'asset', captureId: newId<'CaptureGroup'>() },
      }).success,
    ).toBe(false);
  });
  it('accepts camera staging without inventing a phone identity', () => {
    const file = stagedImportSchema.parse({
      sessionId: newId<'TransferSession'>(),
      uploadId: newId<'TransferUpload'>(),
      path: '/staging/file',
      companions: [],
      fileName: 'camera.mp4',
      sizeBytes: 1,
      mimeType: null,
      lastModified: null,
      reencode: { verdict: 'unknown', reasons: [] },
      receivedAt: 1,
      channel: 'camera',
      source: { label: 'Card' },
    });
    expect(file.device).toBeUndefined();
    expect(file.channel).toBe('camera');
  });
});
