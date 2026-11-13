// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { HubStatus } from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';

/** Why the hub can't be used here, if it can't: Local only first, then a build without the hub's address. */
export type HubBlock = 'localOnly' | 'notConfigured' | null;

export function hubBlock(status: HubStatus | undefined): HubBlock {
  if (!status) return null;
  if (status.localOnly) return 'localOnly';
  return status.configured ? null : 'notConfigured';
}

/**
 * hub.status, read once per page (it always answers), and again on check(): `round` counts the checks, and
 * `checking` holds while the latest one is on its way (the offline notice's Try again spins meanwhile).
 */
export function useHubStatus() {
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const read = useRpcQuery(
    async (signal) => ({ round, status: await backend.hub.status(undefined, { signal }) }),
    [backend, round],
  );
  return {
    data: read.data?.status,
    round,
    // The answer on screen is an older round's: a new check is on its way (it is `loading`, the old answer stale).
    checking: read.status !== 'error' && read.data !== undefined && read.data.round !== round,
    check: () => setRound((n) => n + 1),
  };
}
