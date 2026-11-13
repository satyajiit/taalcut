// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  deviceRunSchema,
  importSessionSchema,
  newId,
  transferFileSchema,
  type DeviceRun,
  type EventOf,
  type ImportSession,
  type TransferFile,
} from '@taalcut/core';
import { vi } from 'vitest';
import { createImportSoundObserver, createSoundEventHandler } from '../../src/features/sounds/sound-events';
import type { SoundPreference } from '../../src/features/sounds/sound-preference';

export function setup() {
  const sounds = { play: vi.fn(), start: vi.fn(() => () => {}) };
  const preference: SoundPreference = {
    getSnapshot: () => ({ enabled: true, ready: true, pending: false, error: null }),
    subscribe: () => () => {},
    refresh: async () => {},
    changed: vi.fn(),
    setEnabled: async () => true,
    cancel: () => {},
  };
  return {
    sounds,
    preference,
    handle: createSoundEventHandler(sounds, preference),
    observe: createImportSoundObserver(sounds),
  };
}

export function command(
  payload: Partial<EventOf<'command.changed'>['payload']> = {},
  at = 1,
): EventOf<'command.changed'> {
  return {
    type: 'command.changed',
    at,
    payload: {
      id: newId<'Command'>(),
      name: 'timeline.trimClip',
      kind: 'executed',
      source: 'ui',
      actor: 'user',
      projectId: newId<'Project'>(),
      ...payload,
    },
  };
}

export function wifiFile(patch: Partial<TransferFile> = {}): TransferFile {
  return transferFileSchema.parse({
    id: newId<'TransferFile'>(),
    sessionId: newId<'TransferSession'>(),
    deviceId: newId<'TransferDevice'>(),
    name: 'clip.mov',
    sizeBytes: 1000,
    receivedBytes: 1000,
    state: 'uploading',
    updatedAt: 1,
    ...patch,
  });
}

export function cableRun(patch: Partial<DeviceRun> = {}): DeviceRun {
  return deviceRunSchema.parse({
    id: newId<'DeviceImportRun'>(),
    deviceKey: 'ABCDEFGHIJKLMNOP',
    deviceLabel: 'Phone',
    sourceId: null,
    state: 'running',
    startedAt: 1,
    updatedAt: 1,
    totals: {
      items: 1,
      bytes: 1000,
      done: 1,
      bytesDone: 1000,
      imported: 1,
      duplicates: 0,
      inICloud: 0,
      rejected: 0,
      failed: 0,
      converted: 0,
    },
    ...patch,
  });
}

export function importSession(patch: Partial<ImportSession> = {}): ImportSession {
  return importSessionSchema.parse({
    id: newId<'ImportSession'>(),
    draftId: null,
    method: 'files',
    sourceLabel: 'Clips',
    sourceId: null,
    status: 'running',
    stage: 'receiving',
    progress: {
      totalItems: 1,
      completedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      archivedItems: 0,
      receivedBytes: 1000,
      totalBytes: 1000,
      bytesPerSecond: null,
      etaSeconds: null,
      currentFile: null,
    },
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    createdAt: 1,
    updatedAt: 1,
    finishedAt: null,
    safeToDisconnect: false,
    ...patch,
  });
}
