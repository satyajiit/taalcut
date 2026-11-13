// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub's error codes as data, so the Worker writes them in its error bodies without core's error registry
 * (a side effect at import). The app's TaalcutError factories for the same codes are in hub-errors.ts; the
 * renderer's catalogue has words for each (`errors.hub.*`, apps/renderer features/templates/hub-messages.ts, which
 * a renderer test keeps in step with this list).
 */
export const HUB_ERROR_CODES = [
  'hub.not_configured',
  'hub.offline',
  'hub.invalid',
  'hub.licence_required',
  'hub.handle_required',
  'hub.rate_limited',
  'hub.busy',
  'hub.not_owner',
  'hub.not_found',
  'hub.hidden',
  'hub.integrity',
  'hub.unsupported_format',
  'hub.github_unavailable',
] as const;
export type HubErrorCode = (typeof HUB_ERROR_CODES)[number];
