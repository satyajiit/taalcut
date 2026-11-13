// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: clip grid, windowed and grouped by day (UX4) · system: DESIGN.md v0.6 + UX4
 * every clip in one scrolling grid, however many: one block per day under a sticky heading (day-heading.tsx), each
 *   starting on a new row; only the rows on screen (and three either side) exist. Sorted by length or quality there
 *   are no days. Tiles are placed with transforms in boxes as tall as their rows, so the scrollbar is honest and the
 *   page scrolls on the compositor; React renders only when a row enters or leaves, a clip is picked or plays.
 * keyboard: one tile in the tab order (and its box, its actions and its day's box after it); arrows step between
 *   clips and days keeping the column, Page Up and Down, Home and End; Space picks, Shift-Space picks a range,
 *   Escape lets the picks go; scrolling to a clip keeps it clear of the sticky heading and of the bar of picks
 * states: the tiles' (asset-tile.tsx); loading rows are still bones
 * motion: clips that arrive (the first page, or a new filter's) rise 8 px and fade in, 40 ms apart, the cascade
 *   capped at 240 ms, on the Web Animations API (transform and opacity, no React per frame); only the ones on
 *   screen, never the rows drawn ahead of the scroll; none on the way back from a clip, where its frame moves.
 *   Reduced motion: a 150 ms fade, no rise, no cascade */
import { useLingui } from '@lingui/react/macro';
import type { AssetSummary, ShotId } from '@taalcut/core';
import { cssEase, DUR, EASE_OUT, errorMessage, REDUCED_FADE, RISE, staggerDelay, toast } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useBackend } from '../../backend/backend';
import { useMediaUrls } from '../../services/provider';
import { AssetTile, BoneTile } from './asset-tile';
import { prefetchClip } from './clip/clip-prefetch';
import { DayHeading } from './day-heading';
import {
  DAY_HEADING,
  dayTimeOf,
  layoutDays,
  moveInDays,
  placeOf,
  windowOf,
  type DayBasis,
} from './day-layout';
import type { ClipSelection } from './selection';
import { GridActions, type ClipGridActions } from './tile-controls';
import { GRID, gridMetrics, type GridMetrics } from './virtual-grid';

export interface ClipGridProps {
  items: readonly AssetSummary[];
  total: number;
  /** Ask for clips up to this index to be loaded. */
  ensure: (count: number) => void;
  /** What the days are counted from; null (sorted by length or quality): no days. */
  days: DayBasis | null;
  selection: ClipSelection;
  /** Clips like this shot (Find similar). */
  onFindSimilar: (shotId: ShotId) => void;
  /** Still bones: nothing has arrived yet. */
  loading: boolean;
  /** Changes when a new set of clips arrives (filters, sort), for the arrival. */
  arrivalKey: string;
  /** "Now" for the dates (the fixture's in tests). */
  now?: number;
}

/** The scroll container the grid sits in: the shell's main area, or the window. */
function scrollerOf(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('[data-slot=scroll-area]') ?? document.documentElement;
}

/** The bar of picks at the foot of the view covers this much of it (bulk-bar.tsx); 0 when it isn't there. */
function footInset(): number {
  return document.querySelector<HTMLElement>('[data-slot=bulk-bar]')?.offsetHeight ?? 0;
}

/** The arrival: what was drawn first rises in, in order, the cascade capped (the kit's motion grammar). */
function arrive(box: HTMLElement): void {
  // Coming back from a clip its frame moves instead; and where there is no Web Animations API, nothing arrives.
  if (document.documentElement.dataset['clipMoving'] !== undefined || typeof box.animate !== 'function')
    return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Only what is on screen arrives. The rows drawn ahead of the scroll (the overscan) are simply there: animated,
  // they'd still be rising, 8 px low, when a quick scroll brings them in, and nobody saw them arrive anyway.
  const view = scrollerOf(box).getBoundingClientRect();
  const parts = [
    ...box.querySelectorAll<HTMLElement>('[data-slot=clip-day-heading], [data-slot=clip-tile-box]'),
  ].filter((part) => {
    const rect = part.getBoundingClientRect();
    return rect.bottom > view.top && rect.top < Math.min(view.bottom, window.innerHeight);
  });
  parts.forEach((part, index) =>
    part.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateY(${RISE}px)` },
            { opacity: 1, transform: 'none' },
          ],
      {
        duration: (reduced ? REDUCED_FADE : DUR.short) * 1000,
        delay: reduced ? 0 : staggerDelay(index) * 1000,
        easing: cssEase(EASE_OUT),
        fill: 'backwards',
      },
    ),
  );
}

/** The grid's actions for its tiles: picking, a preview in the tile, Find similar. Stable, so tiles stay memoised. */
function useTileActions(
  selection: ClipSelection,
  onFindSimilar: (shotId: ShotId) => void,
): [ClipGridActions, { id: string; src: string } | null] {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{ id: string; src: string } | null>(null);
  const latest = useRef({ selection, onFindSimilar, preview });
  latest.current = { selection, onFindSimilar, preview };
  const actions = useMemo<ClipGridActions>(
    () => ({
      pick: (index, range) => latest.current.selection.pick(index, range),
      preview: async (asset) => {
        if (latest.current.preview?.id === asset.id) return setPreview(null);
        const read = await prefetchClip(backend, asset.id);
        if (!read.ok)
          return void toast({
            tone: 'danger',
            title: t`Taalcut couldn’t play this clip`,
            description: errorMessage(i18n, read.error),
          });
        const copy = read.value.playback;
        const src = copy ? media.playback(asset.id, copy) : null;
        // No copy to play yet (or any more): the clip's page says why and offers the fix.
        if (!src) return void navigate({ to: '/library/$assetId', params: { assetId: asset.id } });
        setPreview({ id: asset.id, src });
      },
      findSimilar: async (asset) => {
        const read = await prefetchClip(backend, asset.id);
        const shot = read.ok ? read.value.shots[0] : undefined;
        if (shot) return latest.current.onFindSimilar(shot.id);
        toast({
          tone: 'danger',
          title: t`Taalcut couldn’t look for similar clips`,
          description: read.ok ? t`This clip has no shots to compare yet.` : errorMessage(i18n, read.error),
        });
      },
    }),
    [backend, media, navigate, t, i18n],
  );
  return [actions, preview];
}

export function ClipGrid(props: ClipGridProps) {
  const { items, total, ensure, days, selection, now } = props;
  const { t } = useLingui();
  const effectiveNow = useMemo(() => now ?? Date.now(), [now, items]);
  const box = useRef<HTMLDivElement>(null);
  const headingIds = useId();
  const [metrics, setMetrics] = useState<GridMetrics>(() => gridMetrics(960));
  const [range, setRange] = useState({ first: 0, last: 0 });
  const [active, setActive] = useState(0);
  const focusOnRender = useRef(false);
  const layout = useMemo(() => layoutDays(items, total, metrics, days), [items, total, metrics, days]);
  const [actions, preview] = useTileActions(selection, props.onFindSimilar);

  const measure = useCallback(() => {
    const element = box.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const next = windowOf(layout, -offset, -offset + scroller.clientHeight);
    setRange((prev) => (prev.first === next.first && prev.last === next.last ? prev : next));
  }, [layout]);

  // Columns follow the grid's width; nothing else in the page re-renders for it.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const update = () => {
      const next = gridMetrics(element.clientWidth);
      setMetrics((prev) => (prev.columns === next.columns && prev.tile === next.tile ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    measure();
    const target = scroller === document.documentElement ? window : scroller;
    target.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      target.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // Load ahead of what is on screen: the clips drawn plus three more rows.
  useEffect(() => {
    ensure(Math.min(total, range.last + 3 * metrics.columns));
  }, [ensure, range.last, metrics.columns, total]);

  useEffect(() => {
    if (!focusOnRender.current) return;
    const tile = box.current?.querySelector<HTMLElement>(`[data-index="${active}"] [data-slot=clip-tile]`);
    if (tile) {
      tile.focus({ preventScroll: true });
      focusOnRender.current = false;
    }
  });

  // The clips arrive once per set (the first page, a new filter's): after the bones, not on every scroll.
  const arrived = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (props.loading || items.length === 0 || arrived.current === props.arrivalKey || !box.current) return;
    arrived.current = props.arrivalKey;
    arrive(box.current);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = box.current;
    if (!element) return;
    if (event.key === 'Escape' && selection.selecting) {
      event.preventDefault();
      selection.clear();
      return;
    }
    const scroller = scrollerOf(element);
    const pageRows = Math.max(1, Math.floor(scroller.clientHeight / metrics.row) - 1);
    const next = moveInDays(event.key, active, Math.min(total, items.length), layout, pageRows);
    if (next === null || !(event.target as HTMLElement).closest('[data-slot=clip-tile]')) return;
    event.preventDefault();
    // Bring the row into view if it isn't, clear of the day's sticky heading and the bar of picks.
    const place = placeOf(layout, next);
    if (place) {
      const top =
        element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const rowTop = top + place.top;
      const covered = days ? DAY_HEADING : 0;
      if (rowTop - covered < scroller.scrollTop) scroller.scrollTop = rowTop - covered - GRID.gap;
      else if (rowTop + metrics.row > scroller.scrollTop + scroller.clientHeight - footInset())
        scroller.scrollTop = rowTop + metrics.row - scroller.clientHeight + footInset();
    }
    focusOnRender.current = true;
    setActive(next);
  };

  const outer = metrics.tile + GRID.pad * 2;
  const loaded = Math.min(total, items.length);
  const blocks = useMemo(() => {
    const shown = layout.groups.filter(
      (group) => group.start < range.last && group.start + group.count > range.first,
    );
    // The active tile stays tabbable while on screen; otherwise the first drawn tile takes the tab stop.
    const tabStop = active >= range.first && active < range.last && active < loaded ? active : range.first;
    return shown.map((group) => {
      const from = Math.max(group.start, range.first);
      const to = Math.min(group.start + group.count, range.last);
      const tiles = [];
      for (let index = from; index < to; index += 1) {
        const offset = index - group.start;
        const x = (offset % metrics.columns) * (outer + metrics.gap);
        const y = Math.floor(offset / metrics.columns) * metrics.row;
        const asset = items[index];
        tiles.push(
          asset ? (
            <AssetTile
              key={asset.id}
              asset={asset}
              index={index}
              position={offset + 1}
              setSize={group.count}
              x={x}
              y={y}
              width={outer}
              tabbable={index === tabStop}
              caption={days ? 'time' : 'day'}
              when={dayTimeOf(asset, days ?? 'captured')}
              zone={
                days === 'captured' && asset.capturedAt !== null ? asset.captureOffset?.minutes : undefined
              }
              now={effectiveNow}
              picked={selection.ids.has(asset.id)}
              selecting={selection.selecting}
              preview={preview?.id === asset.id ? preview.src : null}
            />
          ) : (
            <BoneTile key={`bone-${index}`} x={x} y={y} width={outer} />
          ),
        );
      }
      const ids =
        group.day === null ? [] : items.slice(group.start, group.start + group.count).map((a) => a.id);
      const pickedCount = ids.filter((id) => selection.ids.has(id)).length;
      const headingId = `${headingIds}-${group.key}`;
      return (
        <section
          key={group.key}
          data-slot="clip-day"
          data-day={group.day === null ? undefined : group.key}
          {...(group.day === null ? {} : { 'aria-labelledby': headingId })}
          className="group/day absolute inset-x-0"
          style={{ top: group.top, height: group.height }}
        >
          {group.day === null ? null : (
            <DayHeading
              id={headingId}
              day={group.day}
              count={group.count}
              now={effectiveNow}
              picked={pickedCount === 0 ? false : pickedCount === ids.length ? true : 'indeterminate'}
              selecting={selection.selecting}
              tabbable={tabStop >= group.start && tabStop < group.start + group.count}
              onPick={(on) => selection.pickMany(ids, on)}
              trip={group.trip}
            />
          )}
          <ul
            className="relative m-0 list-none p-0"
            style={{ height: Math.max(0, group.rows * metrics.row - metrics.gap) }}
          >
            {tiles}
          </ul>
        </section>
      );
    });
  }, [
    layout,
    range,
    items,
    active,
    outer,
    metrics,
    days,
    effectiveNow,
    selection,
    preview,
    headingIds,
    loaded,
  ]);

  return (
    <GridActions.Provider value={actions}>
      <div
        ref={box}
        role="group"
        aria-label={t`Clips`}
        data-slot="clip-grid"
        data-columns={metrics.columns}
        data-selecting={selection.selecting || undefined}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const index = Number(event.target.closest<HTMLElement>('[data-index]')?.dataset.index);
          if (Number.isInteger(index)) setActive(index);
        }}
        className="relative"
        style={{ height: layout.height }}
      >
        {blocks}
      </div>
    </GridActions.Provider>
  );
}
