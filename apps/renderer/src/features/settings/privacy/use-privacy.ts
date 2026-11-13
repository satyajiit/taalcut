// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What both of Privacy's views read (UX4): the privacy overview, live (Try again re-opens the stream), telemetry's
 * state with its code (not in the overview, so read again after every change there), and the person's commands
 * for the switches (person-only, no inverse: audited, never undone by ⌘Z, never the agent's).
 */
import { useReducer } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../../backend/use-rpc';
import { usePersonCommand } from './use-person-command';

export function usePrivacy() {
  const backend = useBackend();
  const [round, retry] = useReducer((n: number) => n + 1, 0);
  const overview = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend, round]);
  const telemetry = useRpcQuery(
    (signal) => backend.telemetry.state(undefined, { signal }),
    [backend, overview.data],
  );
  const person = usePersonCommand();
  return { overview, retry, telemetry, person };
}
