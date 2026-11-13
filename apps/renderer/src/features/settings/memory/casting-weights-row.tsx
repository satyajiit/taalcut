// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: Settings › Memory › the casting weights row (LRN1-PREF) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.3 · the list's row for the learned `casting-weights` item: the
 *   kit's CastingWeightsItem (the lean in the reader's language, Learned or Adjusted by you, Adjust and Reset)
 *   with core's rules for the weights (casting-weights-rules.ts) and wired to the page's actions, so it waits on another row's change and says why a save failed like any row
 * states: CastingWeightsItem's
 */
import type { MemoryItemView } from '@taalcut/core';
import { CastingWeightsItem } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { castingWeightsOf } from './casting-weights-patch';
import { castingWeightsRules } from './casting-weights-rules';
import { useCastingWeights } from './use-casting-weights';
import type { MemoryActions } from './use-memory-actions';

export function CastingWeightsRow({
  item,
  actions,
  now,
}: {
  item: MemoryItemView;
  actions: MemoryActions;
  now?: number;
}) {
  const weights = useCastingWeights(actions);
  const data = castingWeightsOf(item);
  if (!data) return null;
  return (
    <CastingWeightsItem
      item={item}
      data={data}
      rules={castingWeightsRules(data.defaults)}
      editing={actions.editing === item.id}
      busy={actions.busyOf(item.id)}
      disabled={actions.anyBusy && actions.busyOf(item.id) === null}
      error={actions.errorOf(item.id)}
      onEdit={() => actions.edit(item.id)}
      onCancel={actions.cancel}
      onSave={(next) => void weights.save(item, next)}
      onReset={() => void weights.reset(item)}
      {...(now === undefined ? {} : { now })}
    />
  );
}

/** The list's row for an item: the casting weights' own for their item, else what the list gives (`children`). */
export function CastingWeightsOr({
  item,
  actions,
  now,
  children,
}: {
  item: MemoryItemView;
  actions: MemoryActions;
  now: number | undefined;
  children: ReactNode;
}) {
  if (!castingWeightsOf(item)) return <>{children}</>;
  return <CastingWeightsRow item={item} actions={actions} {...(now === undefined ? {} : { now })} />;
}
