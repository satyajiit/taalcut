// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT2: the other shots a template's cast kept for a clip, offered where the clip is. Wraps the editor's scenes
 * strip and detailed timeline; resting the pointer on a clip (or ↑ on the focused one) opens a small popover above
 * it with the slot's shots, and one press swaps one in. It is a popover in the kit's sense: the overlay surface,
 * a hairline, the pop from its side (a fade alone under reduced motion), kept inside the window by its collision
 * padding. It never opens for a clip with nothing else to offer, for a timeline without a cast, or while the AI
 * holds the timeline, and it never sits over the clip it belongs to, so the press that selects a clip still lands.
 * When and how it opens and closes: use-other-shots.ts.
 */
import { useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { Popover, PopoverAnchor, PopoverContent } from '@taalcut/ui';
import { useId, useMemo, type ReactNode } from 'react';
import type { TimelineModel } from '../model';
import type { ShotLookup } from '../shot-frames';
import type { Edits } from '../use-edits';
import { OtherShotsList } from './other-shots-list';
import { optionsFor } from './shot-options';
import { anchorRect, useOtherShots } from './use-other-shots';

export interface OtherShotsProps {
  model: TimelineModel;
  edits: Edits;
  lookup: ShotLookup;
  /** The AI is editing: manual edits wait, so nothing is offered. */
  paused?: boolean;
  /** The scenes strip and the detailed timeline. */
  children: ReactNode;
}

export function OtherShots({ model, edits, lookup, paused = false, children }: OtherShotsProps) {
  const { t, i18n } = useLingui();
  const labelId = useId();
  const canShow = (clipId: TimelineItemId) => !paused && optionsFor(model, clipId) !== null;
  const shots = useOtherShots(canShow);
  const { shown } = shots;
  const clip = shown ? model.clips.find((view) => view.item.id === shown.clipId) : undefined;
  const options = shown ? optionsFor(model, shown.clipId) : null;
  const anchor = useMemo(
    () => ({ current: { getBoundingClientRect: () => (shown ? anchorRect(shown) : new DOMRect()) } }),
    [shown],
  );
  const n = clip ? i18n.number(clip.number) : '';
  // It belongs to the editor: near the editor's edge it moves in, and never lies over the chat beside it.
  const within = shown?.anchor.closest('[data-slot="timeline-editor"]') ?? [];

  return (
    <>
      <div data-slot="other-shots-zone" {...shots.zone}>
        {children}
      </div>
      <Popover
        open={shots.open && !!clip && !!options}
        onOpenChange={(next) => {
          if (!next) shots.close();
        }}
      >
        <PopoverAnchor virtualRef={anchor} />
        {shown && clip && options ? (
          <PopoverContent
            key={shown.clipId}
            ref={shots.panel}
            side="top"
            align="center"
            sideOffset={8}
            collisionBoundary={within}
            aria-labelledby={labelId}
            data-slot="other-shots"
            className="w-auto max-w-[calc(100vw-24px)] gap-2 p-2.5"
            onOpenAutoFocus={(event) => {
              // The pointer opened it: focus stays where the person left it.
              event.preventDefault();
              if (shown.by !== 'keys') return;
              shots.panel.current?.querySelector<HTMLElement>('[data-option]:not([data-current])')?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
            onEscapeKeyDown={shots.over.onEscapeKeyDown}
            onPointerEnter={shots.over.onPointerEnter}
            onPointerLeave={shots.over.onPointerLeave}
          >
            <OtherShotsList
              label={shown.scene ? t`Other shots for scene ${n}` : t`Other shots for clip ${n}`}
              labelId={labelId}
              clip={clip}
              model={model}
              options={options}
              edits={edits}
              lookup={lookup}
              onBack={shots.close}
            />
          </PopoverContent>
        ) : null}
      </Popover>
    </>
  );
}
