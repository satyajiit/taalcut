// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Use this Mac instead" (G8): moves one job to a model on this Mac while its cloud provider is limited. It is
 * Settings › Models' own override command (models.setModuleOverride, dispatched as the person), so it is
 * undoable: the toast's Undo is the app-wide ⌘Z. Offered only when the job has a local model that can run now
 * and isn't already on one.
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, MODEL_COMMANDS, newId, type ModelModuleId, type ModelOption } from '@taalcut/core';
import { errorMessage, toast } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';
import { useModelOptions } from '../models/model-options';
import { jobName } from './usage-words';

export interface LocalInstead {
  /** The local model a job would move to, or null when there is none to offer. */
  localFor(module: ModelModuleId): ModelOption | null;
  move(module: ModelModuleId): Promise<void>;
  /** The job being moved right now. */
  pending: ModelModuleId | null;
}

export function useLocalInstead(): LocalInstead {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const options = useModelOptions();
  const settings = useRpcStream((signal) => backend.models.changed(undefined, { signal }), [backend]);
  const [pending, setPending] = useState<ModelModuleId | null>(null);

  const localFor = (module: ModelModuleId): ModelOption | null => {
    const state = settings.data?.modules.find((m) => m.module === module);
    const primary = state?.chain[0];
    const list = options.data?.[module] ?? [];
    const alreadyLocal =
      primary && list.some((o) => o.local && o.provider === primary.provider && o.model === primary.model);
    if (!state || alreadyLocal) return null;
    return list.find((o) => o.local && o.unavailable === undefined) ?? null;
  };

  const move = async (module: ModelModuleId) => {
    const choice = localFor(module);
    const state = settings.data?.modules.find((m) => m.module === module);
    if (!choice || !state) return;
    setPending(module);
    const result = await callRpc(
      backend.commands.dispatch({
        name: MODEL_COMMANDS.setModuleOverride,
        payload: {
          module,
          override: { ...state.override, primary: { provider: choice.provider, model: choice.model } },
        },
        source: 'ui',
        idempotencyKey: newId(),
      }),
    );
    setPending(null);
    const job = jobName(i18n, module);
    if (!result.ok) {
      toast({
        tone: 'danger',
        title: t`Couldn’t move ${job} to this Mac`,
        description: errorMessage(i18n, result.error),
      });
      return;
    }
    toast({
      title: t`${job} runs on this Mac now`,
      action: {
        label: t`Undo`,
        onSelect: () =>
          void callRpc(backend.commands.undo({ projectId: null, source: 'ui' })).then((undone) => {
            if (!undone.ok)
              toast({
                tone: 'danger',
                title: t`Couldn’t undo that`,
                description: errorMessage(i18n, undone.error),
              });
          }),
      },
    });
  };

  return { localFor, move, pending };
}
