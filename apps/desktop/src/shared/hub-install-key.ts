// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub's install key (P3-B12, templates SPEC "Hub client"; core's `hubInstallKeySchema`): 128 random bits,
 * base64url, kept in main's keychain vault (main/hub/hub-install-key.ts). The agent process asks main for it on
 * each hub write through main's credentials service, under this provider id; nothing caches it, and it never
 * reaches a window, a log or an error.
 */
import {
  callRpc,
  err,
  hubInstallKeySchema,
  ok,
  UnknownError,
  type AsyncResult,
  type MainServicesClient,
} from '@taalcut/core';

/** The provider id main's credentials service answers with the install key. */
export const HUB_INSTALL_KEY_PROVIDER = 'taalcut-hub';

/** The agent's read: the key from main, or main's error; a missing or malformed answer names no value. */
export async function readHubInstallKey(
  credentials: Pick<MainServicesClient<'agent'>['credentials'], 'get'>,
): AsyncResult<string> {
  const answered = await callRpc(credentials.get({ provider: HUB_INSTALL_KEY_PROVIDER }));
  if (!answered.ok) return answered;
  const key = hubInstallKeySchema.safeParse(answered.value?.secret);
  return key.success
    ? ok(key.data)
    : err(UnknownError(undefined, { detail: 'no hub install key from main' }));
}
