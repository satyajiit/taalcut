// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AsyncResult,
  CaptureGroupId,
  EventBus,
  TransferSessionId,
  TransferUploadId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../../db/database';
import type { ImportCreateInput } from '../../imports/adapter';
import type { VolumeProbe } from '../../sources/volumes';
import type { CaptureFile, MediaCapturePlan } from './camera-profiles';

export interface LocalImportAdapterDeps {
  readonly db: LibraryDatabase;
  readonly originalsRoot: () => Promise<string>;
  readonly volumes: VolumeProbe;
  readonly pick: (input: ImportCreateInput) => AsyncResult<readonly string[]>;
  readonly events?: Pick<EventBus, 'emit'>;
  readonly thumbnailUrl?: (id: string) => string;
  readonly inspectCapture?: (file: CaptureFile) => Promise<CaptureFile['evidence']>;
}

export interface LocalImportData {
  readonly root: string;
  readonly roots: readonly string[];
  readonly sourceRoot: string;
  readonly volume: string;
  readonly removable: boolean;
  readonly sourceVolumes?: readonly string[];
  readonly transferSessionId: TransferSessionId;
}

export interface LocalImportLocator {
  readonly capture: MediaCapturePlan;
  readonly captureId: CaptureGroupId;
  readonly uploadIds: Readonly<Record<string, TransferUploadId>>;
  readonly sourceVolume?: string;
  readonly sourceMount?: string;
}
