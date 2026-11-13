// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { redactText } from '@taalcut/library';
import { creationSourceUrl } from '@taalcut/tools';

const credentialKey = (key: string) =>
  /^(?:(?:access|refresh|id|oauth|auth)?token|api(?:key|secret)|clientsecret|secret|password|authorization|xamz(?:signature|credential|securitytoken))$/i.test(
    key.replace(/[-_]/g, ''),
  );

/** Refuse recognizable credentials before a command can persist the source or its original audit payload. */
export function persistableCreationUrl(raw: string): boolean {
  if (!creationSourceUrl(raw) || redactText(raw) !== raw) return false;
  const url = new URL(raw);
  if ([...url.searchParams.keys()].some(credentialKey)) return false;
  const fragment = url.hash.slice(1);
  const fragmentQuery = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment;
  return ![...new URLSearchParams(fragmentQuery).keys()].some(credentialKey);
}
