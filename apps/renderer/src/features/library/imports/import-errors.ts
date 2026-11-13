// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';

/** Explicit ids let shared error surfaces resolve the backend's recovery messages from the catalogue. */
export const IMPORT_ERROR_MESSAGES = [
  msg({
    id: 'errors.desktop.photos_permission_denied',
    message: 'Taalcut can’t read Photos. Allow Photos access in your privacy settings, then connect again.',
  }),
  msg({
    id: 'errors.desktop.photos_selection_changed',
    message:
      'The selected Photos originals have changed or are no longer available. Connect to Photos and choose them again.',
  }),
  msg({
    id: 'errors.library.import_selection_unavailable',
    message: 'The selected originals are no longer available. Reconnect the source and choose them again.',
  }),
  msg({
    id: 'errors.library.import_source_changed',
    message: 'An original changed after you selected it. Check the source and choose the originals again.',
  }),
  msg({
    id: 'errors.library.import_space_unavailable',
    message:
      'Taalcut couldn’t reserve enough space for this import. Free up space at the destination, then try again.',
  }),
  msg({
    id: 'errors.library.import_verification_failed',
    message:
      'Taalcut couldn’t verify a saved copy. Keep the source connected and retry the unfinished items.',
  }),
  msg({
    id: 'errors.library.import_volume_busy',
    message:
      'This source is still in use. Wait for its imports and other file operations to finish, then try again.',
  }),
] as const;
