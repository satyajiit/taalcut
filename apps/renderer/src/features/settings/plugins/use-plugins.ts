// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type Result, type TaalcutError } from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';

/** The catalogue stays current when an agent asks the person to set up a plugin. */
export function usePlugins() {
  const backend = useBackend();
  const state = useRpcQuery((signal) => backend.plugins.list(undefined, { signal }), [backend]);
  useBackendEvents(['command.changed'], (event) => {
    if (event.payload.name.startsWith('plugins.')) state.reload();
  });
  return state;
}

export function usePluginActions(reload: () => void) {
  const command = useCommand({ toast: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  async function execute(key: string, call: () => Promise<Result<unknown>>) {
    setPending(key);
    setError(null);
    const result = await call();
    setPending(null);
    if (!result.ok) setError(result.error);
    reload();
    return result.ok;
  }
  return {
    pending,
    error,
    run: (key: string, call: () => Promise<unknown>) => execute(key, () => callRpc(call())),
    dispatch: (key: string, name: string, payload: unknown) =>
      execute(key, () => command.run({ name, payload })),
  };
}

export type PluginActions = ReturnType<typeof usePluginActions>;
