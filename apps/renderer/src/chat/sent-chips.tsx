// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: sent chips (wiring) · system: DESIGN.md v0.3 · the kit's SelectionChip on a sent
 * message: pressing one opens what it points at again (the editor with the clip selected, the template);
 * one whose clip or slot is gone is struck through, "This was deleted." · states: the kit's */

import { useLingui } from '@lingui/react/macro';
import type { SelectionChip as Chip } from '@taalcut/core';
import { SelectionChip } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useChipViews, type ResolvedChip } from './selection-views';

export function SentChips({ chips }: { chips: readonly Chip[] }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const resolved = useChipViews(chips);

  const open = (entry: ResolvedChip) => {
    const { chip, projectId } = entry;
    if (chip.kind === 'effect') return;
    if (chip.kind === 'asset') {
      void navigate({ to: '/library/$assetId', params: { assetId: chip.assetId } });
      return;
    }
    if (chip.kind === 'slot') {
      void navigate({ to: '/templates/$templateId', params: { templateId: chip.templateId } });
      return;
    }
    if (!projectId) return;
    void navigate({
      to: '/projects/$projectId/timeline',
      params: { projectId },
      search: { timeline: chip.timelineId, ...(chip.kind === 'clip' ? { clip: chip.clipId } : {}) },
    });
  };

  return (
    <>
      {resolved.map((entry) =>
        entry.view ? (
          <SelectionChip
            key={entry.key}
            chip={entry.view}
            gone={entry.gone}
            {...(entry.gone || entry.chip.kind === 'effect' ? {} : { onOpen: () => open(entry) })}
          />
        ) : entry.gone ? (
          // Gone before this chat could know its words.
          <span
            key={entry.key}
            data-slot="selection-chip"
            data-gone=""
            className="inline-flex h-6 items-center rounded-pill bg-chip px-2 text-xs font-semibold text-ink-3"
          >
            {t`This was deleted.`}
          </span>
        ) : null,
      )}
    </>
  );
}
