// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The action filter's choices (LIB1-FIND): every action the library's clips show, most clips first
 * (`library.actions`), asked again when the library changes, since a clip described since then may show a new one.
 * Null until the library first answers, so the pill can tell "none yet" from "not asked yet".
 */
import type { ActionCount } from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';

export function useShotActions(): readonly ActionCount[] | null {
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const actions = useRpcQuery((signal) => backend.library.actions(undefined, { signal }), [backend, round]);
  useBackendEvents(['library.changed'], () => setRound((n) => n + 1));
  return actions.data?.actions ?? null;
}
