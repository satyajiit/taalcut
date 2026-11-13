// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words for what `templates.fetchMedia` can fail with (REF1) that no other page had words for: templates carries
 * keys, never English, and the kit's errorMessage finds these by key. `templates.fetch_failed` already has its words
 * (the kit's domain messages).
 */
import { msg } from '@lingui/core/macro';

export const REEL_MEDIA_MESSAGES = [
  msg({
    id: 'errors.templates.no_origin_link',
    message: 'This template has no link to its reel, so Taalcut can’t get the reel again.',
  }),
  msg({
    id: 'errors.templates.fetch_unavailable',
    message: 'The link downloader isn’t ready yet. Taalcut gets it on its own; try again in a minute.',
  }),
  msg({
    id: 'errors.templates.reference_too_long',
    message: 'That reel is longer than three minutes, so Taalcut won’t keep it.',
  }),
  msg({
    id: 'errors.templates.no_video',
    message: 'That link has no video in it any more. Check that the reel is still up.',
  }),
];
