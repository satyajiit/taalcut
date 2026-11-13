// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the Library's bar of picked clips (UX4) · system: DESIGN.md v0.6 + UX4 (Bulk selection, the icon
 *   registry, the motion grammar)
 * while clips are picked: how many, Done, then Remove from library and the screen's one marigold fill, "Make a video
 *   with these", which opens a new chat with the clips named in its composer. It stands on the column at the foot of
 *   the view, over the grid, so it stays at hand however far the picking goes (a list's bar sits above its rows; a
 *   grid of thousands scrolls it away), and the grid keeps a clip it moves to clear of it.
 * states: Make a video: default · hover · focus · active · disabled n/a (any clip can be picked; the chat says what
 *   it can't use) · Remove: default · hover · focus · active · loading (while the command runs) · error (a toast
 *   with the cause) · success (a toast with Undo; the picks go) · disabled (over 1,000 picked: one command, and so
 *   one Undo, takes at most that many) · Done: the Button's
 * motion: it rises in from the foot (animate-enter: 4 px and a fade, --dur-short); reduced motion: a fade */
import { plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import { LIBRARY_COMMANDS, newId, type AssetId, type AssetSummary } from '@taalcut/core';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { COMPOSER_DRAFT_KEY } from '../../chat/handoff';
import { addSelection, clearSelections } from '../../chat/selection-store';
import { useCommand } from '../../backend/use-command';
import { useUndoable } from '../make/use-undoable';
import { MakeShortButton } from '../shorts/make-short-button';

/** The most clips one Remove takes (the command's own limit). */
const REMOVE_AT_MOST = 1000;

export interface BulkBarProps {
  ids: ReadonlySet<AssetId>;
  /** The grid's clips so far: the picked ones' names, in the grid's order. */
  items: readonly AssetSummary[];
  onDone: () => void;
}

/** The composer's first words for the picked clips: their names, in the grid's order. */
export function useVideoDraft(): (names: readonly string[]) => string {
  const { t, i18n } = useLingui();
  return (names) => {
    if (names.length === 1) {
      const name = names[0];
      return t`Make a short video with my clip “${name}”`;
    }
    const list = new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(names);
    return t`Make a short video with my clips ${list}`;
  };
}

export function BulkBar({ ids, items, onDone }: BulkBarProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const command = useCommand();
  const undoable = useUndoable();
  const draft = useVideoDraft();
  const [reanalysing, setReanalysing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const seen = new Set<AssetId>();
  const picked = items.filter((item) => {
    if (!ids.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const count = ids.size;

  const makeVideo = () => {
    clearSelections();
    for (const item of picked) {
      addSelection({ kind: 'asset', assetId: item.id, name: item.name });
    }
    try {
      sessionStorage.setItem(COMPOSER_DRAFT_KEY, draft(picked.map((item) => item.name)));
    } catch {
      // Storage blocked: the chat opens with an empty composer, which is still the way on.
    }
    void navigate({ to: '/chat/$conversationId', params: { conversationId: newId<'Conversation'>() } });
  };

  const reanalyse = async () => {
    setReanalysing(true);
    const result = await command.run({
      name: LIBRARY_COMMANDS.reindexAssets,
      payload: { assetIds: [...ids] },
    });
    setReanalysing(false);
    if (result.ok) onDone();
  };

  const remove = async () => {
    setRemoving(true);
    const result = await undoable.run({
      name: LIBRARY_COMMANDS.trashAssets,
      payload: { assetIds: [...ids] },
      projectId: null,
      done: t`${plural(count, { one: 'Removed # clip from your library', other: 'Removed # clips from your library' })}`,
      failed: t`Couldn’t remove the clips`,
    });
    setRemoving(false);
    if (result.ok) onDone();
  };

  return (
    <div
      data-slot="bulk-bar"
      role="region"
      aria-label={t`Selected clips`}
      className="sticky bottom-4 z-10 flex animate-enter flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-rule bg-overlay py-2 ps-4 pe-2 shadow-lg"
    >
      <p role="status" className="m-0 type-label text-ink tabular-nums">
        <Plural value={count} one="# clip selected" other="# clips selected" />
      </p>
      <Button size="sm" variant="ghost" onClick={onDone}>
        {t`Done`}
      </Button>
      <span className="ms-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={VERB_ICONS.retry}
          loading={reanalysing}
          disabled={removing || count > REMOVE_AT_MOST}
          onClick={() => void reanalyse()}
        >
          {t`Analyse again`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={VERB_ICONS.delete}
          loading={removing}
          // One command takes at most this many clips (library.trashAssets), so one Undo puts them all back.
          disabled={reanalysing || count > REMOVE_AT_MOST}
          onClick={() => void remove()}
        >
          {t`Remove from library`}
        </Button>
        {count === 1 && picked[0]?.kind === 'video' ? (
          <MakeShortButton source={{ kind: 'asset', assetId: picked[0].id, name: picked[0].name }} />
        ) : null}
        <Button size="sm" variant="primary" icon={VERB_ICONS.makeVideo} onClick={makeVideo}>
          {t`Make a video with these`}
        </Button>
      </span>
    </div>
  );
}
