// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: memory scope field (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · where a remembered item applies: "Applies to", then a segmented choice (Every video,
 *   A project…, A template…) and, for a project or template, the picker naming the one chosen (MemoryScopePicker).
 *   Choosing A project… or A template… opens the picker at once. A choice the item can't take (what an export taught
 *   belongs to a template) is disabled, never hidden
 * states: default · hover · focus · active · disabled (the whole field, or one choice) · loading and error (the
 *   picker's) · success (the choice and the name show) · invalid (a project or template still to choose: the
 *   picker's button says "Choose a project")
 * motion: the segmented thumb (Segmented); nothing of its own
 */
import { useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import { Segmented } from '../components/segmented';
import { MemoryScopePicker, type MemoryScopePickerProps } from './memory-scope-picker';

export type MemoryScopeKind = 'user' | 'project' | 'template';

export interface MemoryScopeFieldProps {
  readonly kind: MemoryScopeKind;
  /** The caller forgets the chosen project or template when the kind changes. */
  onKindChange(kind: MemoryScopeKind): void;
  /** Choices this item can't take (core's memoryItemProblems): shown, disabled. */
  readonly disabledKinds?: readonly MemoryScopeKind[];
  /** The project or template picker, for those kinds. */
  readonly picker: Omit<MemoryScopePickerProps, 'kind' | 'disabled'>;
  readonly disabled?: boolean;
}

export function MemoryScopeField({
  kind,
  onKindChange,
  disabledKinds = [],
  picker,
  disabled = false,
}: MemoryScopeFieldProps) {
  const { t } = useLingui();
  const labelId = useId();
  const options = [
    { value: 'user' as const, label: t`Every video` },
    { value: 'project' as const, label: t`A project…` },
    { value: 'template' as const, label: t`A template…` },
  ].map((option) => ({ ...option, disabled: disabledKinds.includes(option.value) }));
  return (
    <div data-slot="memory-scope-field" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id={labelId} className="type-meta text-ink-2">
        {t`Applies to`}
      </span>
      <Segmented
        labelledBy={labelId}
        value={kind}
        options={options}
        disabled={disabled}
        onChange={(next) => {
          if (next === kind) return;
          onKindChange(next);
          // A project or a template still has to be chosen: open the picker for it.
          if (next !== 'user') picker.onOpenChange(true);
        }}
      />
      {kind === 'user' ? null : <MemoryScopePicker {...picker} kind={kind} disabled={disabled} />}
    </div>
  );
}
