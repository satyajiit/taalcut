// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a scene's own actions (MORE1, from the clip inspector) · system: DESIGN.md v0.7
 * Lock and Add to chat, beside a selected scene's title wherever the editor shows one: the clip inspector's
 *   header, the Trim tool's title and the More tab's scene group
 * states: the buttons' eight · locked (Lock reads Unlock and is pressed) · loading (Lock spins while its edit
 *   is on its way) · error (the editor's line under the transport)
 */
import { useLingui } from '@lingui/react/macro';
import { Button, cn, useShortcutFormat, VERB_ICONS } from '@taalcut/ui';
import { Lock, LockOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ACCELERATORS } from './keys';
import type { ClipView } from './model';
import type { Edits } from './use-edits';

export interface SceneActionsProps {
  clip: ClipView;
  edits: Edits;
  onAddToChat(): void;
  /** More of the scene's actions, after these (the More tab's Comment). */
  children?: ReactNode;
  /**
   * In a row that shares its line with a title (the More tab): the words give way to the glyphs where the panel
   * is narrow but not stacked. Unlock keeps its word, because a locked scene's line says "Unlock it".
   */
  compact?: boolean;
}

/** A compact label: read out always, shown where its container is stacked (under 32rem) or wide (from 36rem). */
const COMPACT_LABEL = 'sr-only @max-lg:not-sr-only @xl:not-sr-only';

export function SceneActions({ clip, edits, onAddToChat, children, compact = false }: SceneActionsProps) {
  const { t } = useLingui();
  const shortcut = useShortcutFormat();
  const addKeys = shortcut.text(ACCELERATORS.addToChat);
  const [busy, setBusy] = useState(false);
  const locked = clip.item.locked;
  const lock = async () => {
    setBusy(true);
    try {
      await edits.lock(clip.item.id, !locked);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn('flex flex-wrap items-center', compact ? 'gap-0.5' : 'gap-1.5')}
      data-slot="clip-actions"
    >
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={locked}
        loading={busy}
        icon={locked ? LockOpen : Lock}
        title={compact ? (locked ? t`Unlock` : t`Lock`) : undefined}
        onClick={() => void lock()}
      >
        <span className={compact && !locked ? COMPACT_LABEL : undefined}>{locked ? t`Unlock` : t`Lock`}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-keyshortcuts={shortcut.aria(ACCELERATORS.addToChat)}
        title={t`Add to chat (${addKeys})`}
        icon={VERB_ICONS.addToChat}
        onClick={onAddToChat}
      >
        <span className={compact ? COMPACT_LABEL : undefined}>{t`Add to chat`}</span>
      </Button>
      {children}
    </div>
  );
}
