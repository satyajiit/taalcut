// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the composer's Effects picker (UX4, B14) · Operate · system: DESIGN.md v0.7
 * The Effects button in the composer's tool row (the registry's effect glyph; no sparkle) and its sheet above the
 *   composer: the effects by what they change (titles and graphics, camera, cuts, captions and sound), each tile a
 *   drawn picture of the effect, its name and one plain line. Several can be picked: each is a chip in the tray, the
 *   button counts them, and Clear takes them all off.
 * states: as PickerButton and PickerSheet (composer-picker.tsx) · picked (the count on the button, in the AI's
 *   violet: the agent applies them) */
import { useLingui } from '@lingui/react/macro';
import { forwardRef } from 'react';
import { Button } from '#components/button';
import { CONCEPT_ICONS, VERB_ICONS } from '../icons/concepts';
import { PickerButton, PickerSheet } from '../chat/composer-picker';
import { EffectPicture } from './effect-pictures';
import type { ComposerEffects } from './effect-types';

export interface EffectsButtonProps {
  readonly effects: ComposerEffects;
  readonly open: boolean;
  readonly sheetId: string;
  readonly onClick: () => void;
}

/** The tool row's Effects button, with how many are picked. */
export const EffectsButton = forwardRef<HTMLButtonElement, EffectsButtonProps>(function EffectsButton(
  { effects, open, sheetId, onClick },
  ref,
) {
  const { t, i18n } = useLingui();
  const count = effects.selected.length;
  return (
    <PickerButton
      ref={ref}
      data-slot="effects-button"
      data-picker-button=""
      data-active={count > 0 || undefined}
      icon={<CONCEPT_ICONS.effect />}
      label={t`Effects`}
      open={open}
      sheetId={sheetId}
      onClick={onClick}
      className={count > 0 ? 'text-ai-strong' : undefined}
      badge={
        count > 0 ? (
          <span
            data-slot="effects-count"
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-ai-soft px-1.5 type-caption text-ai-strong tabular-nums"
          >
            {i18n.number(count)}
          </span>
        ) : null
      }
    />
  );
});

/** The sheet: every effect, drawn, by what it changes. Picking toggles; the sheet stays for the next. */
export function EffectsSheet({ effects, onClose }: { effects: ComposerEffects; onClose: () => void }) {
  const { t } = useLingui();
  const selected = new Set(effects.selected);
  const groups = effects.groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      id: group.id,
      label: group.label,
      tiles: group.items.map((item) => ({
        id: item.id,
        label: item.label,
        ...(item.description ? { description: item.description } : {}),
        picture: <EffectPicture effectId={item.id} />,
        selected: selected.has(item.id),
      })),
    }));
  return (
    <PickerSheet
      slot="effects-menu"
      title={t`Effects`}
      hint={t`Pick one or more. Taalcut puts each where it fits the cut.`}
      groups={groups}
      mode="many"
      tileAttribute="data-effect"
      onPick={(id) => effects.onToggle(id as (typeof effects.selected)[number])}
      onClose={onClose}
      actions={
        effects.selected.length > 0 && effects.onClear ? (
          <Button
            variant="ghost"
            size="sm"
            data-slot="effects-clear"
            icon={VERB_ICONS.clearFilters}
            onClick={() => effects.onClear?.()}
          >
            {t`Clear effects`}
          </Button>
        ) : null
      }
    />
  );
}
