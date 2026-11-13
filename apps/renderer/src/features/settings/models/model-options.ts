// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MODEL_MODULE_IDS, type ModelModuleId, type ModelChoice, type ModelOption } from '@taalcut/core';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';

export type OptionsByModule = Readonly<Partial<Record<ModelModuleId, readonly ModelOption[]>>>;

export const choiceKey = (choice: Pick<ModelChoice, 'provider' | 'model'>) =>
  `${choice.provider}/${choice.model}`;

/** What can be picked for every module. Small lists, fetched once per visit. */
export function useModelOptions() {
  const backend = useBackend();
  return useRpcQuery(
    async (signal) => {
      const lists = await Promise.all(
        MODEL_MODULE_IDS.map((module) => backend.models.options({ module }, { signal })),
      );
      return Object.fromEntries(
        MODEL_MODULE_IDS.map((module, i) => [module, lists[i] ?? []]),
      ) as OptionsByModule;
    },
    [backend],
  );
}

/** The model's product name, else its id. Either way it's a name: render it with translate="no". */
export function modelName(
  options: OptionsByModule | undefined,
  choice: Pick<ModelChoice, 'provider' | 'model'>,
) {
  for (const list of Object.values(options ?? {})) {
    const found = list?.find((o) => o.provider === choice.provider && o.model === choice.model);
    if (found) return found.name;
  }
  return choice.model;
}
