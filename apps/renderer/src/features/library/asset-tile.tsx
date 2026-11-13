// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: clip tile (UX4) · system: DESIGN.md v0.6 + UX4 (the kit's Checkbox, the icon registry, the motion
 *   grammar)
 * the clip in a 9:16 frame on the viewer grey (the shape of the short), at its own shape; a caption line under it:
 *   its length, and the time it was shot (the day is the heading above) or its day when the grid has no days. While
 *   pointed at, focused within or picked: its box at the frame's top start and Play, Find similar and Open at its
 *   foot (tile-controls.tsx)
 * states: default · hover (hover surface round the frame) · focus (base ring, roving) · active (pressed surface)
 *   · picked (the selected wash round it, the frame drawn in a little with an ink edge, the box ticked) · selecting
 *   (a plain click picks; Enter still opens) · previewing (the clip plays in its frame, muted) · loading (still
 *   bone tile while its page loads; the picture fades in, opacity only) · error (a chip: "Can't open this file")
 *   · a picture that won't load (the frame keeps its grey with a still "no picture" mark) · offline, analysing,
 *   searchable, waits for a model, smaller copy (still chips: the page's import line carries the motion) · while
 *   analysed, a still 2 px line along the frame's foot says how far (LIB1-PROG) · disabled n/a
 * motion: opening grows the frame into the clip page's viewer (clip-transition.ts); picking draws the frame in by
 *   transform and fades its edge in (--dur-short, --ease-out); reduced motion: the edge alone, no scale
 * contrast: caption ink-2 on canvas, hover and selected ≥ 7:1; chip words on canvas ≥ 4.5:1 */
import { useLingui } from '@lingui/react/macro';
import type { AssetSummary } from '@taalcut/core';
import { CONCEPT_ICONS, cn, HOVER_EASE } from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CircleAlert,
  HardDrive,
  Hourglass,
  Image as ImageIcon,
  ImageOff,
  Search,
  Smartphone,
} from 'lucide-react';
import { memo, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useBackend } from '../../backend/backend';
import { useMediaUrls } from '../../services/provider';
import { formatClipLength, formatDay } from '../shared/format';
import { prefetchClip } from './clip/clip-prefetch';
import { claimClosingFrame, CLIP_FRAME_TRANSITION, openClip } from './clip/clip-transition';
import { TileActions, TileSelect, useGridActions } from './tile-controls';

const seconds = (time: AssetSummary['duration']) => (time ? (time.value * time.rate.den) / time.rate.num : 0);

type Chip = 'failed' | 'offline' | 'model' | 'searchable' | 'analysing' | 'smaller';

/** Held for a model or its original (LIB1-PROG): nothing runs for it, so it isn't "Analysing". */
const heldForModel = (asset: AssetSummary) => asset.index.state === 'waiting' && asset.index.held === 'model';

function chipOf(asset: AssetSummary): Chip | null {
  if (
    asset.index.state === 'failed' &&
    asset.thumbnail === null &&
    (asset.index.searchableAt ?? null) === null
  )
    return 'failed';
  if (asset.availability === 'offline') return 'offline';
  if (heldForModel(asset)) return 'model';
  if (asset.index.state === 'indexing' || asset.index.state === 'waiting')
    return (asset.index.searchableAt ?? null) !== null ? 'searchable' : 'analysing';
  return asset.reencode === 'likely' ? 'smaller' : null;
}

const CHIPS = {
  failed: [CircleAlert, 'text-danger-strong'],
  offline: [HardDrive, 'text-ink-2'],
  model: [CONCEPT_ICONS.model, 'text-ink-2'],
  searchable: [Search, 'text-ink-2'],
  analysing: [Hourglass, 'text-ink-2'],
  smaller: [Smartphone, 'text-warning-strong'],
} as const;

/**
 * How far a clip being analysed has got, as a still 2 px line along the frame's foot (LIB1-PROG): never over the
 * picture's centre, no motion of its own (the page's one line carries that), gone once it is done or held. The
 * chip above says it in words; this only shows how far, so it is hidden from assistive tech.
 */
function TileProgress({ asset }: { asset: AssetSummary }) {
  const { done, total, state } = asset.index;
  if (state !== 'indexing' || total <= 0) return null;
  return (
    <span
      aria-hidden
      data-slot="clip-tile-progress"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-viewer"
    >
      <span
        className="absolute inset-0 origin-left bg-viewer-ink-2"
        style={{ transform: `scaleX(${Math.min(1, done / total)})` }}
      />
    </span>
  );
}

/**
 * A clip that isn't plainly ready says why on its frame, still (the page's one import line carries the motion):
 * can't be opened, its drive isn't connected, searchable while its details are still analysed, still being
 * analysed, a smaller copy. At the frame's top end, clear of the box.
 */
function StatusChip({ asset }: { asset: AssetSummary }) {
  const { t } = useLingui();
  const chip = chipOf(asset);
  if (chip === null) return null;
  const [Icon, tone] = CHIPS[chip];
  const word = {
    failed: t`Can’t open this file`,
    offline: t`Drive not connected`,
    model: t`Waits for a model`,
    searchable: t`Searchable`,
    analysing: t`Analysing`,
    smaller: t`Smaller copy`,
  }[chip];
  return (
    <span
      data-slot="clip-status"
      className={cn(
        'absolute top-1 right-1 flex max-w-[calc(100%-2.25rem)] items-start gap-1 rounded-sm bg-canvas px-1 py-px type-caption',
        tone,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-3 shrink-0" />
      {word}
    </span>
  );
}

/** How long a pointer rests on a tile before its clip is read ahead (the router's own preload waits as long). */
const INTENT_MS = 60;

export interface AssetTileProps {
  asset: AssetSummary;
  index: number;
  /** Its place in its day's list, and the list's length. */
  position: number;
  setSize: number;
  /** Where the grid puts it, px, and its width. Numbers, so a tile's props stay equal while it holds still. */
  x: number;
  y: number;
  width: number;
  tabbable: boolean;
  /** The words under the frame: the time it was shot (the grid has days) or its day. */
  caption: 'time' | 'day';
  /** The time its day is counted from (shot, or added). */
  when: number;
  /**
   * LIB1-PLACE: the offset `when` is told at, minutes east of UTC, when the file names where it was shot (its day
   * is counted on that calendar too, day-layout.ts); undefined: this computer's.
   */
  zone?: number | undefined;
  now: number;
  picked: boolean;
  selecting: boolean;
  /** The clip's copy, while it plays in its frame. */
  preview: string | null;
}

/** One clip in the grid: its picture, then its length and time. Opens the clip, or picks it while selecting. */
export const AssetTile = memo(function AssetTile(props: AssetTileProps) {
  const { asset, index, tabbable, picked, selecting, preview } = props;
  const { t, i18n } = useLingui();
  const media = useMediaUrls();
  const backend = useBackend();
  const actions = useGridActions();
  const nameId = useId();
  const src = asset.thumbnail ? media.derived(asset.thumbnail) : null;
  const [shown, setShown] = useState(false);
  const [broken, setBroken] = useState(false);
  // The box and the actions exist while the tile is pointed at or has focus within (or is picked, or plays).
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const navigate = useNavigate();

  const open = () =>
    openClip(frame.current, asset.id, () =>
      navigate({ to: '/library/$assetId', params: { assetId: asset.id } }),
    );
  const readAhead = () => void prefetchClip(backend, asset.id);
  // A plain press opens the clip with its frame growing into the viewer; while selecting (or with Shift or ⌘) it
  // picks. Enter is a click with no pointer (detail 0): it always opens.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.altKey) return;
    const keyboard = event.detail === 0;
    if (event.shiftKey || event.metaKey || event.ctrlKey || (selecting && !keyboard)) {
      event.preventDefault();
      actions.pick(index, event.shiftKey);
      return;
    }
    event.preventDefault();
    open();
  };
  // Space picks the focused clip, as in Finder; Shift-Space every clip from the last one ticked.
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    actions.pick(index, event.shiftKey);
  };
  // The clip closing back into this tile (the way back from its page): the frame it shrinks into.
  useLayoutEffect(() => claimClosingFrame(frame.current, asset.id), [asset.id]);
  const length = asset.kind === 'image' ? t`Photo` : formatClipLength(i18n, seconds(asset.duration));
  const live = pointed || focused || picked || preview !== null;

  return (
    <li
      data-index={index}
      aria-setsize={props.setSize}
      aria-posinset={props.position}
      className="absolute top-0 left-0 [contain:layout_style]"
      style={{ width: props.width, transform: `translate3d(${props.x}px,${props.y}px,0)` }}
    >
      <div
        data-slot="clip-tile-box"
        data-picked={picked || undefined}
        className="group/tile relative"
        onPointerEnter={() => {
          setPointed(true);
          intent.current = setTimeout(readAhead, INTENT_MS);
        }}
        onPointerLeave={() => {
          setPointed(false);
          if (intent.current) clearTimeout(intent.current);
        }}
        onFocus={() => {
          setFocused(true);
          readAhead();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <Link
          to="/library/$assetId"
          params={{ assetId: asset.id }}
          tabIndex={tabbable ? 0 : -1}
          data-slot="clip-tile"
          aria-describedby={selecting ? `${nameId}-picking` : undefined}
          draggable={false}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className={cn(
            'flex flex-col gap-1.5 rounded-lg p-1',
            HOVER_EASE,
            picked ? 'bg-selected' : 'hover:bg-hover active:bg-pressed',
          )}
        >
          <span
            ref={frame}
            className={cn(
              'relative block aspect-[9/16] overflow-hidden rounded-md bg-viewer',
              'transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
              picked && 'scale-[0.94] motion-reduce:scale-100',
              CLIP_FRAME_TRANSITION,
            )}
          >
            {src && !broken ? (
              <img
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                data-shown={shown || undefined}
                onLoad={() => setShown(true)}
                onError={() => setBroken(true)}
                className="absolute inset-0 size-full object-contain opacity-0 transition-opacity duration-(--dur-micro) ease-(--ease-out) data-[shown]:opacity-100"
              />
            ) : broken ? (
              <ImageOff
                aria-hidden
                data-slot="no-picture"
                className="absolute inset-0 m-auto size-5 text-viewer-rule"
              />
            ) : asset.kind === 'image' ? (
              <ImageIcon aria-hidden className="absolute inset-0 m-auto size-5 text-viewer-rule" />
            ) : null}
            {preview ? (
              <video
                data-slot="clip-preview"
                src={preview}
                muted
                autoPlay
                playsInline
                onEnded={() => void actions.preview(asset)}
                onError={() => void actions.preview(asset)}
                className="absolute inset-0 size-full object-contain"
              />
            ) : null}
            <StatusChip asset={asset} />
            <TileProgress asset={asset} />
            {/* The picked edge: drawn once, faded in (opacity), so picking moves nothing but the frame's scale. */}
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 rounded-md border-2 border-inverse opacity-0',
                'transition-opacity duration-(--dur-short) ease-(--ease-out)',
                picked && 'opacity-100',
              )}
            />
          </span>
          <span className="flex h-4 min-w-0 items-center gap-1.5 px-0.5 type-meta text-ink-2">
            <span id={nameId} className="sr-only" translate="no" data-user-content>
              {asset.name}
            </span>
            {selecting ? (
              <span id={`${nameId}-picking`} className="sr-only">
                {picked ? t`Selected` : t`Not selected`}
              </span>
            ) : null}
            <span className="shrink-0 tabular-nums">{length}</span>
            <time
              dateTime={new Date(props.when).toISOString()}
              className="ms-auto shrink-0 font-sans tabular-nums"
            >
              {props.caption === 'time'
                ? props.zone === undefined
                  ? i18n.date(new Date(props.when), { timeStyle: 'short' })
                  : i18n.date(new Date(props.when + props.zone * 60_000), {
                      timeStyle: 'short',
                      timeZone: 'UTC',
                    })
                : formatDay(i18n, props.when, props.now)}
            </time>
          </span>
        </Link>
        {live || selecting ? (
          <TileSelect index={index} picked={picked} tabbable={tabbable} nameId={nameId} />
        ) : null}
        {live ? (
          <TileActions asset={asset} tabbable={tabbable} previewing={preview !== null} onOpen={open} />
        ) : null}
      </div>
    </li>
  );
});

/** A clip whose page hasn't arrived yet: still bones in the tile's own shape. */
export function BoneTile({ x, y, width }: { x: number; y: number; width: number }) {
  return (
    <li
      aria-hidden
      className="absolute top-0 left-0"
      style={{ width, transform: `translate3d(${x}px,${y}px,0)` }}
    >
      <span className="flex flex-col gap-1.5 p-1">
        <span className="tc-bone block aspect-[9/16] rounded-md bg-hover" />
        <span className="tc-bone block h-4 w-2/3 rounded-sm bg-hover" />
      </span>
    </li>
  );
}
