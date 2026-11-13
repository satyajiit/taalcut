// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { Result } from '@taalcut/core';
import { useHostPlatform } from '@taalcut/ui';
import { useCallback } from 'react';
import { failureToast } from '../shell-states/failure-toast';
import { useBackend } from './backend';
import { fixCommand } from './fix-command';
import { useRpcAction } from './use-rpc';

export interface CommandRequest {
  readonly name: string;
  readonly payload: unknown;
}

export interface CommandOptions {
  /**
   * A failure shows as a toast that names the cause, with the error's fix (or Try again) as its button, so no
   * command fails silently (UX1 X6). Pass false where the caller shows the error itself, beside what failed.
   * Default true.
   */
  readonly toast?: boolean;
}

/**
 * Dispatches a command on the bus as the user ('ui'). Every state change in
 * Settings goes this way, so it is undoable and audited like the agent's.
 * `run` always resolves to the dispatch's Result.
 */
export function useCommand(options: CommandOptions = {}): {
  run: (request: CommandRequest) => Promise<Result<unknown>>;
  pending: boolean;
} {
  const backend = useBackend();
  const { i18n } = useLingui();
  const platform = useHostPlatform();
  const toastFailures = options.toast ?? true;
  const action = useRpcAction((request: CommandRequest) =>
    backend.commands.dispatch({ name: request.name, payload: request.payload, source: 'ui' }),
  );
  const dispatch = action.run;
  const run = useCallback(
    async (request: CommandRequest): Promise<Result<unknown>> => {
      const result = await dispatch(request);
      if (!result.ok && toastFailures)
        failureToast(
          i18n,
          result.error,
          {
            // The fix is a command too: it goes the same way, so a fix that fails says so as well.
            fix: (fix) => void run(fixCommand(fix)),
            retry: () => void run(request),
          },
          platform,
        );
      return result;
    },
    [dispatch, toastFailures, i18n, platform],
  );
  return { run, pending: action.pending };
}
