// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportStatus } from '@taalcut/core';

/** The stages every clip passes before it is in the Library with its poster frame (media's thumbnail, IX-D4). */
export const IMPORTED_STAGES = ['library.hash', 'media.normalise', 'media.thumbnail'] as const;

/**
 * "Imported" (docs/onboarding.md section 2): the import has left scanning and receiving, and hashing, probing
 * and posters have nothing left. Descriptions, speech and search may still be running.
 */
export function isImported(status: ImportStatus): boolean {
  if (status.state === 'done') return true;
  if (status.state === 'scanning' || status.state === 'receiving') return false;
  return IMPORTED_STAGES.every(
    (name) => (status.stages.find((each) => each.stage === name)?.left ?? 0) === 0,
  );
}
