// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ChatEffectCategory, ChatEffectId } from '@taalcut/core';

/** One named video effect as the kit shows it: already translated for the current locale. */
export interface EffectItem {
  readonly id: ChatEffectId;
  readonly label: string;
  readonly description?: string;
}

/** Effects of one category ("Motion graphics", "Camera & framing"…), under its heading in the menu. */
export interface EffectGroup {
  readonly id: ChatEffectCategory;
  readonly label: string;
  readonly items: readonly EffectItem[];
}

/** The composer's Effects CTA button and multi-select menu. */
export interface ComposerEffects {
  readonly groups: readonly EffectGroup[];
  readonly selected: readonly ChatEffectId[];
  onToggle(effectId: ChatEffectId): void;
  onClear?(): void;
  onClose?(): void;
}

