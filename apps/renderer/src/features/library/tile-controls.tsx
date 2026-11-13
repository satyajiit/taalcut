// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a clip tile's box and its actions (UX4) · system: DESIGN.md v0.6 + UX4 (the kit's Checkbox, the icon
 *   registry, the motion grammar)
 * the box at the frame's top start; Play, Find similar and Open at its foot, small round buttons on the control
 *   face, each named and with its tooltip. They are the tile's siblings, never inside its link, so nothing
 *   interactive nests; they exist only while the tile is pointed at, has focus within or is picked, so scrolling
 *   mounts plain tiles. In the tab order only on the grid's tab stop: Tab from a tile reaches its box, then its
 *   actions.
 * states: the box: Checkbox's (unticked, ticked, hover, focus, active) · the actions: Button's (default, hover,
 *   focus, active; Play swaps to Stop while the preview plays; loading while the clip is read) · error: a toast
 *   says why (grid-actions.ts)
 * motion: the controls fade in (animate-fade-in, opacity only); the tick draws itself in (Tick) */
import { useLingui } from '@lingui/react/macro';
import type { AssetSummary } from '@taalcut/core';
import {
  Button,
  Checkbox,
  cn,
  renderIcon,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VERB_ICONS,
  type IconLike,
} from '@taalcut/ui';
import { createContext, useContext, useState } from 'react';

/** What the grid does for its tiles: stable functions, so a tile's props alone decide when it draws again. */
export interface ClipGridActions {
  /** Clip `index` in or out of the picked clips; with `range`, every clip from the last one ticked. */
  pick(index: number, range: boolean): void;
  /** Plays the clip in its tile, muted, or stops it. */
  preview(asset: AssetSummary): Promise<void>;
  /** Shows clips that look like this one (its first shot). */
  findSimilar(asset: AssetSummary): Promise<void>;
}

const NOOP: ClipGridActions = {
  pick: () => undefined,
  preview: () => Promise.resolve(),
  findSimilar: () => Promise.resolve(),
};

export const GridActions = createContext<ClipGridActions>(NOOP);

export const useGridActions = (): ClipGridActions => useContext(GridActions);

/** Fades in as the controls mount; reduced motion keeps the fade (opacity is not movement). */
const ARRIVE = 'animate-fade-in';

/** The tile's box: picks the clip. Named "Select" and the clip's name, by reference. */
export function TileSelect({
  index,
  picked,
  tabbable,
  nameId,
}: {
  index: number;
  picked: boolean;
  tabbable: boolean;
  /** The id of the tile's hidden name, so the box reads "Select IMG_2034.MOV". */
  nameId: string;
}) {
  const { t } = useLingui();
  const actions = useGridActions();
  const wordId = `${nameId}-select`;
  return (
    <span data-slot="clip-select" className={cn('absolute top-3.5 left-3 z-[1] flex', ARRIVE)}>
      <span id={wordId} hidden>
        {t`Select`}
      </span>
      <Checkbox
        checked={picked}
        // The click carries Shift; the box's own toggle is ours.
        onCheckedChange={() => undefined}
        onClick={(event) => {
          event.preventDefault();
          actions.pick(index, event.shiftKey);
        }}
        tabIndex={tabbable ? 0 : -1}
        aria-labelledby={`${wordId} ${nameId}`}
      />
    </span>
  );
}

function TileAction({
  label,
  icon,
  tabbable,
  pressed,
  onClick,
}: {
  label: string;
  icon: IconLike;
  tabbable: boolean;
  pressed?: boolean;
  onClick: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          aria-label={label}
          {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
          loading={busy}
          tabIndex={tabbable ? 0 : -1}
          className="size-7 rounded-pill border-rule shadow-xs"
          onClick={() => {
            const done = onClick();
            if (!done) return;
            setBusy(true);
            void done.finally(() => setBusy(false));
          }}
        >
          {busy ? null : renderIcon(icon, 'sm')}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Play, Find similar and Open, at the frame's foot. */
export function TileActions({
  asset,
  tabbable,
  previewing,
  onOpen,
}: {
  asset: AssetSummary;
  tabbable: boolean;
  previewing: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const actions = useGridActions();
  const video = asset.kind === 'video';
  return (
    <span
      data-slot="clip-tile-actions"
      // Inside the frame's foot: the tile's padding, its caption line and the gap above it, then 6 px.
      className={cn('absolute right-2 bottom-8 z-[1] flex items-center gap-1', ARRIVE)}
    >
      {video ? (
        <TileAction
          label={previewing ? t`Stop the preview` : t`Play a preview`}
          icon={previewing ? VERB_ICONS.stop : VERB_ICONS.play}
          pressed={previewing}
          tabbable={tabbable}
          onClick={() => actions.preview(asset)}
        />
      ) : null}
      {asset.shotCount > 0 ? (
        <TileAction
          label={t`Find similar`}
          icon={VERB_ICONS.findSimilar}
          tabbable={tabbable}
          onClick={() => actions.findSimilar(asset)}
        />
      ) : null}
      <TileAction label={t`Open`} icon={VERB_ICONS.open} tabbable={tabbable} onClick={onOpen} />
    </span>
  );
}
