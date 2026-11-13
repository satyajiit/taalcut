// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the learned casting weights' row does (LRN1-PREF), through the command bus as the person, holding the rows as
 * any row's Edit and Delete do: Save sends the weights a person set (`memory.update`, naming the revision it read,
 * patch from casting-weights-patch.ts; unchanged weights only close the editor), and Reset deletes the item, so
 * casting is back on its defaults (`memory.delete`: the toast's Undo brings the weights back).
 */
import { useLingui } from '@lingui/react/macro';
import type { CastingWeights, MemoryItemView } from '@taalcut/core';
import { castingWeightsOf, castingWeightsPatch } from './casting-weights-patch';
import type { MemoryActions } from './use-memory-actions';

export function useCastingWeights(actions: Pick<MemoryActions, 'cancel' | 'saveItem' | 'deleteItem'>) {
  const { t } = useLingui();

  const save = async (item: MemoryItemView, weights: CastingWeights) => {
    const data = castingWeightsOf(item);
    const patch = data ? castingWeightsPatch(data, weights) : null;
    if (!patch) return actions.cancel();
    await actions.saveItem(item, patch);
  };

  // The toast says whether the reset failed, as a deletion's does.
  const reset = (item: MemoryItemView) =>
    actions.deleteItem(item, {
      done: t`Casting is back on its defaults`,
      detail: () => t`New casts weigh every part the usual way.`,
      failed: t`Couldn’t reset casting`,
    });

  return { save, reset };
}
