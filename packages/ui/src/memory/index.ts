// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-MEM: Settings → Memory's pieces, re-exported by the package's index.ts. */
export { MemoryItem, type MemoryItemBusy, type MemoryItemProps } from './memory-item';
export { MemoryProposalCard } from './memory-proposal-card';
export { MemoryScopeField, type MemoryScopeFieldProps, type MemoryScopeKind } from './memory-scope-field';
export {
  MemoryScopePicker,
  type MemoryScopeOption,
  type MemoryScopePickerProps,
} from './memory-scope-picker';
export { MemorySourceBadge, type MemorySourceBadgeProps } from './memory-source-badge';
export { MemoryTextField, type MemoryTextFieldProps } from './memory-text-field';
// LRN1-PREF: the learned casting weights' item and editor.
export { CastingWeightsEditor, type CastingWeightsEditorProps } from './casting-weights-editor';
export { CastingWeightsItem, type CastingWeightsItemProps } from './casting-weights-item';
export type { CastingWeightReach, CastingWeightsLean, CastingWeightsRules } from './casting-weights-rules';
export { CastingWeightSlider, type CastingWeightSliderProps } from './casting-weights-slider';
export {
  CASTING_PART_LABELS,
  castingWeightsSentence,
  type CastingWeightsData,
} from './casting-weights-words';
