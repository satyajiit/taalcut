// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Connects the Composer's Effects CTA to the selection store so users can tag
 * single or multiple video effects on a chat message.
 */
import { useLingui } from '@lingui/react/macro';
import type { ChatEffectId } from '@taalcut/core';
import type { ComposerEffects } from '@taalcut/ui';
import { useMemo, useRef, type RefObject } from 'react';
import {
  askWith,
  clearEffectSelections,
  toggleSelection,
  useSelections,
} from '../../chat/selection-store';
import { buildEffectGroups, starterPromptForEffects } from './effects';

export function useComposerEffects(rootRef?: RefObject<HTMLElement | null>): ComposerEffects {
  const { i18n } = useLingui();
  const pending = useSelections();
  const lastAutoPrompt = useRef<string>('');

  const selected = useMemo<readonly ChatEffectId[]>(
    () =>
      pending.flatMap((entry) =>
        entry.chip.kind === 'effect' ? [entry.chip.effectId] : [],
      ),
    [pending],
  );

  const selectedRef = useRef<readonly ChatEffectId[]>(selected);
  selectedRef.current = selected;

  const groups = useMemo(() => buildEffectGroups(i18n), [i18n, i18n.locale]);

  const syncStarterPrompt = (nextIds: readonly ChatEffectId[]) => {
    const textarea = rootRef?.current?.querySelector('textarea');
    const currentText = textarea?.value.trim() ?? '';
    if (currentText.length > 0 && currentText !== lastAutoPrompt.current) return;
    const nextPrompt = starterPromptForEffects(i18n, nextIds);
    lastAutoPrompt.current = nextPrompt;
    if (nextPrompt) askWith(nextPrompt, []);
  };

  return useMemo<ComposerEffects>(
    () => ({
      groups,
      selected,
      onToggle(effectId) {
        const outcome = toggleSelection({ kind: 'effect', effectId });
        if (outcome === 'full') return;
        selectedRef.current =
          outcome === 'added'
            ? [...selectedRef.current, effectId]
            : selectedRef.current.filter((id) => id !== effectId);
      },
      onClear() {
        selectedRef.current = [];
        clearEffectSelections();
      },
      onClose() {
        syncStarterPrompt(selectedRef.current);
      },
    }),
    [groups, selected, i18n],
  );
}

