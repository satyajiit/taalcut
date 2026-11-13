// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The graphics inspectors' commands (EDT1-GFX, HFW1-UI): which control is busy and which one failed, by its key. */
import type { TaalcutError } from '@taalcut/core';
import { useState } from 'react';
import { useCommand } from '../../backend/use-command';

/** Busy and failed controls by key, over the renderer's command hook (no toasts: errors show under the control). */
export function useKeyedCommand() {
  const command = useCommand({ toast: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; error: TaalcutError } | null>(null);
  const run = async (key: string, name: string, payload: unknown) => {
    setBusy(key);
    setError(null);
    const done = await command.run({ name, payload });
    setBusy(null);
    if (!done.ok) setError({ key, error: done.error });
    return done.ok;
  };
  return { busy, error, run };
}
