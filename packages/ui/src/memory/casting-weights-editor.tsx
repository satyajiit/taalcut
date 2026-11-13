// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: casting weights editor (LRN1-PREF) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · opened in place by the casting item's Adjust: the lean as one sentence that follows the
 *   draft, the item's provenance (children), one line on what the weights do, then the five parts as a compact
 *   three-column grid (name · slider · share) and Save (secondary: the page's one marigold is Add) and Cancel.
 *   Moving one part shares the difference among the others (the rules' `fit`: core's fitCastingWeights holding the
 *   moved one), so the five always keep casting's total and stay inside their bounds; a part you moved turns teal
 * states: default · hover/focus-visible/active (each control's own) · disabled (the sliders while Save is on its
 *   way) · loading (Save spins) · error (the cause under the grid; the draft stays) · success (silent: the caller
 *   closes it and the list re-reads)
 * keys: Tab through the parts and the buttons, Escape cancels
 * motion: none
 */
import { useLingui } from '@lingui/react/macro';
import type { CastingWeightKey, CastingWeights, TaalcutError } from '@taalcut/core';
import { useState, type ReactNode } from 'react';
import { ErrorLine } from '../cards/error-line';
import { Button } from '../components/button';
import type { CastingWeightsRules } from './casting-weights-rules';
import { CastingWeightSlider } from './casting-weights-slider';
import { castingWeightsSentence, type CastingWeightsData } from './casting-weights-words';
import type { MemoryItemBusy } from './memory-item';

export interface CastingWeightsEditorProps {
  readonly data: CastingWeightsData;
  /** Core's rules for these weights, bound to their defaults (the kit imports no core code). */
  readonly rules: CastingWeightsRules;
  readonly busy: MemoryItemBusy;
  readonly error?: TaalcutError | null;
  /** Shown under the sentence: the item's provenance. */
  readonly children?: ReactNode;
  onCancel(): void;
  /** The draft, inside the bounds at the defaults' total; the caller closes the editor once it is saved. */
  onSave(weights: CastingWeights): void;
}

export function CastingWeightsEditor({
  data,
  rules,
  busy,
  error,
  children,
  onCancel,
  onSave,
}: CastingWeightsEditorProps) {
  const { i18n, t } = useLingui();
  const [weights, setWeights] = useState<CastingWeights>(data.weights);
  // Weights a person last set (no pairs behind them) are theirs from the start.
  const [moved, setMoved] = useState<ReadonlySet<CastingWeightKey>>(
    () => new Set(data.pairs === 0 ? rules.parts : []),
  );
  const saving = busy === 'save';
  const change = (key: CastingWeightKey, value: number) => {
    setWeights((current) => rules.fit({ ...current, [key]: value }, key));
    setMoved((current) => new Set([...current, key]));
  };
  return (
    <div
      role="group"
      aria-label={t`Adjust how Taalcut picks shots`}
      data-slot="casting-weights-editor"
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || saving) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <p data-slot="casting-weights-lean" className="m-0 type-body text-ink">
          {castingWeightsSentence(i18n, rules.lean(weights))}
        </p>
        {children}
      </div>
      <p className="m-0 max-w-prose type-meta text-ink-2">
        {t`How much each part counts when Taalcut picks a shot for a slot. Moving one shares the difference among the others.`}
      </p>
      <div className="grid max-w-2xl grid-cols-[minmax(0,11rem)_minmax(6rem,1fr)_auto] items-center gap-x-4 gap-y-1.5">
        {rules.parts.map((key, index) => (
          <CastingWeightSlider
            key={key}
            part={key}
            value={weights[key]}
            fallback={data.defaults[key]}
            reach={rules.reach[key]}
            units={rules.units}
            yours={moved.has(key)}
            disabled={saving}
            autoFocus={index === 0}
            onChange={(value) => change(key, value)}
          />
        ))}
      </div>
      {error ? <ErrorLine key={error.code} error={error} /> : null}
      <div className="flex gap-2">
        <Button size="sm" loading={saving} onClick={() => onSave(weights)}>
          {t`Save`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          {t`Cancel`}
        </Button>
      </div>
    </div>
  );
}
