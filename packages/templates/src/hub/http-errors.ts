// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A failed hub response as a TaalcutError: the Worker's error body when it sent one (core's hubErrorBodySchema),
 * otherwise the HTTP status (docs/template-hub.md section 7). Nothing from the request, the install key above
 * all, goes on the error.
 */
import {
  HubBusy,
  HubGithubUnavailable,
  HubHandleRequired,
  HubHidden,
  HubIntegrity,
  HubLicenceRequired,
  HubNotConfigured,
  HubNotFound,
  HubNotOwner,
  HubOffline,
  HubRateLimited,
  HubUnsupportedFormat,
  hubErrorBodySchema,
  type HubErrorBody,
  type HubErrorCode,
  type TaalcutError,
} from '@taalcut/core';
import { hubInvalid } from './hub-invalid';
import { jsonBodyOf } from './json-body';

const FROM_BODY: Record<HubErrorCode, (body: HubErrorBody) => TaalcutError> = {
  'hub.not_configured': () => HubNotConfigured(),
  'hub.offline': () => HubOffline(),
  'hub.invalid': (body) => hubInvalid(body.problems ?? []),
  'hub.licence_required': () => HubLicenceRequired(),
  'hub.handle_required': () => HubHandleRequired(),
  'hub.rate_limited': (body) => HubRateLimited({ retryAfterSeconds: body.retryAfterSeconds ?? 0 }),
  'hub.busy': () => HubBusy(),
  'hub.not_owner': () => HubNotOwner(),
  'hub.not_found': () => HubNotFound(),
  'hub.hidden': () => HubHidden(),
  'hub.integrity': () => HubIntegrity(),
  'hub.unsupported_format': (body) => {
    const version = body.params?.formatVersion;
    return HubUnsupportedFormat({ formatVersion: typeof version === 'number' ? version : 0 });
  },
  'hub.github_unavailable': () => HubGithubUnavailable(),
};

function fromStatus(status: number, retryAfter: string | null): TaalcutError {
  if (status === 429) {
    const seconds = Number(retryAfter);
    return HubRateLimited({
      retryAfterSeconds: Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : 1,
    });
  }
  if (status === 404) return HubNotFound();
  if (status === 409) return HubNotOwner();
  if (status === 400 || status === 413 || status === 422) return hubInvalid([{ path: '', rule: 'schema' }]);
  if (status === 503) return HubGithubUnavailable();
  if (status === 500 || status === 502 || status === 504) return HubBusy();
  return HubOffline();
}

/** The error a non-2xx hub response stands for. */
export function hubHttpError(status: number, bodyText: string, retryAfter: string | null): TaalcutError {
  const body = jsonBodyOf(hubErrorBodySchema, bodyText);
  return body.ok ? FROM_BODY[body.value.code](body.value) : fromStatus(status, retryAfter);
}
