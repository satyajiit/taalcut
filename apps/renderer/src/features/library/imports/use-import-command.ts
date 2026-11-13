// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, newId, type TaalcutError } from '@taalcut/core';
import { useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';

/** One command per gesture. The bus receipt is returned only after its durable write succeeds. */
export function useImportCommand() {
  const backend = useBackend();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const run = async <T>(name: string, payload: unknown): Promise<T | null> => {
    if (locked.current) return null;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await callRpc(
        backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }),
      );
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result.value.result as T;
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  return { run, pending, error };
}
