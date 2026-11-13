// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MediaCapturePlan } from './camera-profiles';

export interface ArchiveMember {
  readonly name: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly required: boolean;
}

export interface CaptureArchive {
  readonly id: string;
  readonly key: string;
  readonly familyKey?: string;
  readonly profile: MediaCapturePlan['profile'];
  readonly directory: string;
  readonly members: readonly ArchiveMember[];
  readonly requiredNames: readonly string[];
  readonly missingNames: readonly string[];
  readonly completeness: MediaCapturePlan['completeness'];
  readonly warnings: readonly string[];
}
