// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: item inspector (EDT1, the fallback) · system: DESIGN.md v0.6 + UX4
 * any selected item that has no inspector of its own (the inspector sends graphics to gfx's, audio and captions
 *   to ops's first): its name and number, when it plays and for how long, its words (as written, never
 *   translated), and how to point the chat at it (Add to chat, Clear); plain canvas, the inspector's column
 * states: each control carries the eight · gone (the item went: the editor lets go of it) · loading: the page's
 *   bones · error: the editor's line · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { findEditItem, type EditItemPlace, type Timeline } from '@taalcut/core';
import { Button, useShortcutFormat, useTimecode, UserContent, VERB_ICONS } from '@taalcut/ui';
import type { ReactNode } from 'react';
import { ACCELERATORS, KEYS } from './keys';
import type { TimelineModel } from './model';

export interface ItemInspectorProps {
  model: TimelineModel;
  timeline: Timeline;
  itemId: string;
  onAddToChat: () => void;
  onClear: () => void;
  /** An item's own controls (EDT1-OPS: a sound's, a caption's), in place of its words and the chat hint. */
  children?: ReactNode;
}

function useItemName() {
  const { t } = useLingui();
  return (place: EditItemPlace) => {
    const n = place.number;
    switch (place.target.itemKind) {
      case 'graphic':
        return t`Graphic ${n}`;
      case 'caption':
        return t`Caption ${n}`;
      case 'audio':
        return t`Audio ${n}`;
      case 'transition':
        return t`Transition ${n}`;
      case 'text':
        return t`Text ${n}`;
      default:
        return t`Clip ${n}`;
    }
  };
}

export function ItemInspector({ model, timeline, itemId, onAddToChat, onClear, children }: ItemInspectorProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const shortcut = useShortcutFormat();
  const name = useItemName();
  const place = findEditItem(timeline, itemId);
  if (!place) return null;
  const addKeys = shortcut.text(ACCELERATORS.addToChat);
  const start = Math.max(0, place.start);
  return (
    <div data-slot="item-inspector" data-item-kind={place.target.itemKind} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-card-title text-ink">{name(place)}</h2>
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {time.clock(start, model.rate)} · {time.length(place.end - start, model.rate)}
        </p>
      </div>
      {children ?? (
        <>
          {place.words ? (
            <p className="m-0 type-body text-ink">
              <UserContent>{place.words}</UserContent>
            </p>
          ) : null}
          <p className="m-0 type-body text-ink-2">
            {t`Ask the chat to change it: “move this to the top”, “make this one shorter”.`}
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          aria-keyshortcuts={shortcut.aria(ACCELERATORS.addToChat)}
          title={t`Add to chat (${addKeys})`}
          icon={VERB_ICONS.addToChat}
          onClick={onAddToChat}
        >
          {t`Add to chat`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-keyshortcuts={KEYS.clear}
          icon={VERB_ICONS.close}
          onClick={onClear}
        >
          {t`Clear`}
        </Button>
      </div>
    </div>
  );
}
