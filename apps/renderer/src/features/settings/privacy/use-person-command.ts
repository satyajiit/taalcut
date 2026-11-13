// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TaalcutError } from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useCommand } from '../../../backend/use-command';

/**
 * Privacy's switches: person-only commands with no inverse (audited, never
 * undone by ⌘Z, never the agent's), dispatched as the user. Tracks which one
 * is on its way and which one failed, so each row shows its own state.
 */
export function usePersonCommand() {
  const { run: dispatch } = useCommand({ toast: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: TaalcutError } | null>(null);

  /** `key` names the row (a command can drive more than one, e.g. telemetry's switch and its code). */
  const run = useCallback(
    async (key: string, name: string, payload: unknown): Promise<boolean> => {
      setBusy(key);
      setFailure(null);
      const result = await dispatch({ name, payload });
      setBusy(null);
      if (!result.ok) setFailure({ key, error: result.error });
      return result.ok;
    },
    [dispatch],
  );

  return {
    run,
    busy: (key: string) => busy === key,
    anyBusy: busy !== null,
    error: (key: string) => (failure?.key === key ? failure.error : null),
  };
}
