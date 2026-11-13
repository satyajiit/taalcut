// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the template hub's error codes (core's HUB_ERROR_CODES, docs/template-hub.md section 7). The
 * app and the hub Worker send the same codes, so a refusal reads the same whichever side made it. The hub client
 * carries keys, never English, so the renderer owns the words, as it does for render's
 * (features/renders/render-messages.ts). Explicit ids: the backend names them.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

export const HUB_MESSAGES: readonly MessageDescriptor[] = [
  msg({
    id: 'errors.hub.not_configured',
    message: 'This copy of Taalcut isn’t set up to reach the template hub.',
  }),
  msg({
    id: 'errors.hub.offline',
    message: 'Taalcut couldn’t reach the template hub. Check your internet connection and try again.',
  }),
  msg({
    id: 'errors.hub.invalid',
    message:
      '{problems, plural, one {This template has # thing to fix before it can be shared.} other {This template has # things to fix before it can be shared.}} The Share card lists them.',
  }),
  msg({
    id: 'errors.hub.licence_required',
    message: 'Sharing needs your OK to the CC0 licence first. Tick it on the Share card.',
  }),
  msg({
    id: 'errors.hub.handle_required',
    message: 'Choose the handle to show with your template, then share it again.',
  }),
  msg({
    id: 'errors.hub.rate_limited',
    message: 'That was a lot for the hub in a short time. Wait a few minutes and try again.',
  }),
  msg({ id: 'errors.hub.busy', message: 'The template hub is busy right now. Try again later.' }),
  msg({
    id: 'errors.hub.not_owner',
    message: 'Only the Mac that first shared this template can update it on the hub.',
  }),
  msg({ id: 'errors.hub.not_found', message: 'That template isn’t on the hub any more.' }),
  msg({
    id: 'errors.hub.hidden',
    message: 'A maintainer took this template off the hub, so it can’t be rated or changed.',
  }),
  msg({
    id: 'errors.hub.integrity',
    message: 'The template Taalcut downloaded didn’t match the hub’s list. Try again in a moment.',
  }),
  msg({
    id: 'errors.hub.unsupported_format',
    message: 'This template needs a newer version of Taalcut. Update Taalcut to open it.',
  }),
  msg({
    id: 'errors.hub.github_unavailable',
    message: 'The hub couldn’t send your template for review just now. Try again in a few minutes.',
  }),
];
