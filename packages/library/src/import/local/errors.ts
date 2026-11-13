// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError } from '@taalcut/core';

export const ImportSourceChanged = defineError('library.import_source_changed', { retryable: true });
export const ImportSpaceUnavailable = defineError('library.import_space_unavailable', { retryable: true });
export const ImportVerificationFailed = defineError('library.import_verification_failed', {
  retryable: true,
});
export const ImportVolumeBusy = defineError('library.import_volume_busy', { retryable: true });
export const ImportSelectionUnavailable = defineError('library.import_selection_unavailable', {
  retryable: true,
});
