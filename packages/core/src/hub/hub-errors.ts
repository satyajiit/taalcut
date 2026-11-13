// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub's errors as TaalcutErrors (P3-B12), for @taalcut/templates' hub client and the agent. Declared in core
 * because the Worker's codes (hub-error-codes.ts) and the app's must be one list; exported from the main entry
 * only, since defining an error registers it.
 */
import { defineError } from '../basics/errors';

export const HubNotConfigured = defineError('hub.not_configured');
export const HubOffline = defineError('hub.offline', { retryable: true });
/** The problems are listed in `detail` and on the Share dialog. */
export const HubInvalid = defineError<{ problems: number }>('hub.invalid');
export const HubLicenceRequired = defineError('hub.licence_required');
export const HubHandleRequired = defineError('hub.handle_required');
export const HubRateLimited = defineError<{ retryAfterSeconds: number }>('hub.rate_limited', {
  retryable: true,
});
export const HubBusy = defineError('hub.busy', { retryable: true });
export const HubNotOwner = defineError('hub.not_owner');
export const HubNotFound = defineError('hub.not_found');
export const HubHidden = defineError('hub.hidden');
export const HubIntegrity = defineError('hub.integrity', { retryable: true });
export const HubUnsupportedFormat = defineError<{ formatVersion: number }>('hub.unsupported_format');
export const HubGithubUnavailable = defineError('hub.github_unavailable', { retryable: true });
