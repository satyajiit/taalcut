// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the Phase 3 error keys @taalcut/timeline, @taalcut/templates and core send that no page words on
 * its own (as make-messages.ts does for Phase 2's): cleanup (P3-V9), the energy curve (P3-V12), brand kits
 * (P3-V10), the voice consent's recording guard (library.voice_recording_mismatch), stock video for a gap
 * (library.stock_*) and Local only's refusal with its fix (core.local_only, fix.openPrivacy). errorMessage finds them by key, so an error line or toast anywhere says
 * them. Explicit ids: the backend names them.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const MAKE_MESSAGES_PHASE3: readonly MessageDescriptor[] = [
  msg({
    id: 'errors.timeline.cleanup_stale',
    message: 'The video changed after this cleanup was planned. Check it again, then apply.',
  }),
  msg({ id: 'errors.timeline.cleanup_no_speech', message: 'There’s no speech in this video to clean up.' }),
  msg({
    id: 'errors.timeline.style_not_found',
    message: 'That brand kit is gone. It may have been deleted in another window.',
  }),
  msg({
    id: 'errors.templates.no_beat_map',
    message: 'This template follows speech, not music beats, so it has no beats to pace.',
  }),
  msg({
    id: 'errors.templates.energy_curve_invalid',
    message: 'These sections don’t cover the whole video. Reset them and try again.',
  }),
  msg({
    id: 'errors.templates.style_in_use',
    message:
      'This brand kit is still used by {timelines, plural, =0 {no videos} one {# video} other {# videos}} and {templates, plural, =0 {no templates} one {# template} other {# templates}}. Give them another look first.',
  }),
  msg({
    id: 'errors.templates.style_image_invalid',
    message:
      '{reason, select, size {That image file is too big. Pick a smaller one.} pixels {That image is too large. Pick a smaller one.} other {Taalcut can use a PNG, JPEG or WebP image. Pick another file.}}',
  }),
  msg({
    id: 'errors.core.local_only',
    message:
      'Local only is on, so Taalcut kept this on your Mac. {what, select, model {Turn it off in Privacy to use a cloud model.} upload {Turn it off in Privacy to send files to the cloud.} reference {Turn it off in Privacy to fetch a reference video.} feedback {Turn it off in Privacy to send feedback.} telemetry {Turn it off in Privacy to share usage data.} stock {Turn it off in Privacy to search stock footage.} hub {Turn it off in Privacy to use the template hub.} other {Turn it off in Privacy to go online.}}',
  }),
  // The consent recording changed between the check and the save (the library's sha256 guard, P3-B6).
  msg({
    id: 'errors.library.voice_recording_mismatch',
    message: 'The recording changed before Taalcut could keep it. Record the consent again.',
  }),
  // Stock video for a gap (P3-B8, UX1): each says what went wrong, never the generic line.
  msg({
    id: 'errors.library.stock_no_key',
    message: 'Stock video needs your Pexels key. Add it in Settings → Accounts.',
  }),
  msg({
    id: 'errors.library.stock_rate_limited',
    message: 'Pexels asked Taalcut to slow down. Wait a minute, then try again.',
  }),
  msg({
    id: 'errors.library.stock_unavailable',
    message: 'Stock video isn’t available right now. Try again later.',
  }),
  msg({ id: 'errors.library.stock_too_large', message: 'That stock video is too big to download. Pick another.' }),
  msg({
    id: 'errors.library.stock_licence_refused',
    message: 'That video’s licence doesn’t let Taalcut use it in your video. Pick another.',
  }),
  msg({
    id: 'errors.library.stock_download_failed',
    message: 'The stock video didn’t download. Check the connection and try again.',
  }),
  // Not "Open Privacy": the hub's own button says that, and one English text under two ids sorts unstably.
  msg({ id: 'fix.openPrivacy', message: 'Go to Privacy' }),
];
