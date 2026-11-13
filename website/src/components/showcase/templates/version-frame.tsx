// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: your version, the template filled and playing · mode: Persuade (footage first) · system: WEB2 Remix
 *   Vernacular (teal is yours: the roll it came from; the slot strip on the picture is white over the scrim)
 * the template filled from a camera roll and re-cut on the reel's own slots: each slot plays its clip's short silent
 *   loop (#content/reels rollClipLoop) for the slot's length, slowed to fill a longer slot down to half speed, then
 *   holding; filled from the reel's own roll it is the reel, so the reel's own video plays. It keeps the saved reel's
 *   clock while that plays, so the two cut on the same frames, and its own clock otherwise
 * states: waiting (the empty roll: a dashed frame, the strip empty, "Waiting for your clips") · filling (the strip fills
 *   slot by slot as the clips land; the last landed clip's still shows) · rest (the server HTML and before it plays:
 *   the first slot's still, the strip full) · playing (on screen in a shown tab) · paused (off screen, tab hidden, or
 *   the visitor's Pause: held until they press Play) · reduced motion (never plays on its own; Play still works) ·
 *   a clip still loading (its still shows through) · the control: default, hover, focus (base ring), active (a 4 %
 *   give), named for what a press does
 * motion: a hard cut from slot to slot, as an edit cuts; nothing else moves but the footage */

import { type MotionValue, useMotionValue, useMotionValueEvent } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { SegmentBar } from '#components/ui/segment-bar';
import { type ReelIntent, reelShouldPlay } from '#components/ui/reel-play';
import { rollClipLoop } from '#content/reels';
import type { Reel } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { spriteStyle } from '../frames';
import { formatLength } from '../timecode';
import { clipRate, type Roll, slotIndexAt, stillOf, type TemplateSlot, templateSegments } from './template';
import { useDriveClock, useOnScreen } from './use-template-clock';

export interface VersionFrameProps {
  readonly reel: Reel;
  readonly slots: readonly TemplateSlot[];
  readonly roll: Roll;
  readonly landed: number;
  /** The template's clock, which this frame drives while it plays. */
  readonly clock: MotionValue<number>;
  /** The saved reel's time, and whether it is playing (then this follows it). */
  readonly follow: MotionValue<number>;
  readonly following: boolean;
  readonly reduce: boolean;
  /** Every time it starts or stops playing. */
  readonly onPlaying: (playing: boolean) => void;
  readonly seconds: (clipId: string) => number;
  readonly compact?: boolean;
  readonly className?: string;
}

export function VersionFrame({
  reel,
  slots,
  roll,
  landed,
  clock,
  follow,
  following,
  reduce,
  onPlaying,
  seconds,
  compact = false,
  className,
}: VersionFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(root, 0.5);
  const [intent, setIntent] = useState<ReelIntent>('auto');
  const empty = roll.picks.length === 0;
  const filled = !empty && landed >= slots.length;
  const playing =
    filled && reelShouldPlay({ intent, autoPlay: true, reduce, onScreen: visible, tabShown: true });
  const [started, setStarted] = useState(false);
  if (playing && !started) setStarted(true);
  const duration = slots.at(-1)?.end ?? 0;
  useDriveClock(clock, { duration, follow, following, running: playing });
  useEffect(() => onPlaying(playing), [playing, onPlaying]);

  // A new fill starts the version from its top.
  const fillKey = `${roll.id}:${filled}`;
  const lastFill = useRef(fillKey);
  useEffect(() => {
    if (lastFill.current === fillKey) return;
    lastFill.current = fillKey;
    if (!following) clock.set(0);
  }, [fillKey, following, clock]);

  const [slot, setSlot] = useState(0);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  useMotionValueEvent(clock, 'change', (t) => {
    const next = slotIndexAt(slots, t);
    if (next !== slot) setSlot(next);
    // The reel's own video keeps to the clock: a seek asked for before it had loaded is made good here.
    const own = roll.own && playing ? videos.current[0] : null;
    if (own && own.readyState >= 1 && !own.seeking && Math.abs(own.currentTime - t) > 0.15)
      own.currentTime = t;
  });
  // While the clips land, the strip fills to the last one landed.
  const progress = useMotionValue(0);
  useEffect(
    () => progress.set(landed > 0 ? (slots[Math.min(landed, slots.length) - 1]?.end ?? 0) : 0),
    [landed, slots, progress],
  );

  const [ready, setReady] = useState<ReadonlySet<number>>(new Set());
  const load = started;
  const shownSlot = filled ? (started ? slot : 0) : Math.max(0, Math.min(landed, slots.length) - 1);

  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      v.muted = true;
      const live = playing && (roll.own ? i === 0 : i === slot);
      if (!live) {
        v.pause();
        return;
      }
      if (roll.own) {
        if (Math.abs(v.currentTime - clock.get()) > 0.15) v.currentTime = clock.get();
      } else {
        const pick = roll.picks[i];
        const length = slots[i]?.length ?? 1;
        v.playbackRate = clipRate(pick ? seconds(pick.clipId) : length, length);
        v.currentTime = 0;
      }
      void v.play().catch(() => undefined);
    });
  }, [playing, slot, roll, slots, clock, seconds]);

  useEffect(() => setReady(new Set()), [roll.id]);
  const onReady = (i: number) => () => setReady((s) => (s.has(i) ? s : new Set([...s, i])));
  const register = (i: number) => (el: HTMLVideoElement | null) => {
    videos.current[i] = el;
  };

  const segments = templateSegments(slots);
  const pick = roll.picks[shownSlot];
  const still = stillOf(pick?.clipId);
  const label = empty ? 'Your version, waiting for your clips' : `Your version, filled from ${roll.label}`;

  if (empty)
    return (
      <div
        ref={root}
        role="img"
        aria-label={label}
        data-slot="version-frame"
        data-state="waiting"
        className={cn(
          'relative flex aspect-[9/16] w-full flex-col rounded-reel border-[1.5px] border-dashed border-rule-strong bg-sunken',
          compact ? 'p-2' : 'p-3',
          className,
        )}
      >
        <SegmentBar segments={segments} state="idle" layout="time" tone="surface" decorative />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
          <span
            aria-hidden
            className="inline-grid size-11 place-items-center rounded-pill border-[1.5px] border-dashed border-rule-strong text-ink-2"
          >
            <Plus strokeWidth={ICON_STROKE} className="size-5" />
          </span>
          <span className="type-label-sm text-ink">Waiting for your clips</span>
          {compact ? null : (
            <span className="type-meta text-ink-2 tabular-nums">
              {slots.length} slots, {formatLength(duration)}
            </span>
          )}
        </div>
      </div>
    );

  return (
    <div
      ref={root}
      data-slot="version-frame"
      data-state={playing ? 'playing' : filled ? 'rest' : 'filling'}
      className={cn('relative aspect-[9/16] w-full', className)}
    >
      <div
        role="img"
        aria-label={label}
        className="absolute inset-0 overflow-hidden rounded-reel bg-viewer shadow-reel"
      >
        {still !== undefined ? (
          <span data-frame="footage" className="absolute inset-0 block" style={spriteStyle(still)} />
        ) : null}
        {load && roll.own ? (
          <video
            ref={register(0)}
            muted
            loop
            playsInline
            preload="auto"
            tabIndex={-1}
            aria-hidden
            onLoadedData={onReady(0)}
            className={cn(
              'absolute inset-0 size-full object-cover',
              ready.has(0) ? 'opacity-100' : 'opacity-0',
            )}
          >
            {reel.reference.map((s) => (
              <source key={s.src} src={s.src} type={s.type} />
            ))}
          </video>
        ) : null}
        {load && !roll.own
          ? roll.picks.map((p, i) => (
              <video
                key={`${roll.id}-${i}`}
                ref={register(i)}
                muted
                playsInline
                preload="auto"
                tabIndex={-1}
                aria-hidden
                data-version-clip={p.clipId}
                onLoadedData={onReady(i)}
                className={cn(
                  'absolute inset-0 size-full object-cover',
                  i === shownSlot && ready.has(i) ? 'opacity-100' : 'opacity-0',
                )}
              >
                {rollClipLoop(p.clipId).map((s) => (
                  <source key={s.src} src={s.src} type={s.type} />
                ))}
              </video>
            ))
          : null}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-viewer/55 to-transparent"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-viewer/55 to-transparent"
        />
      </div>
      <div className="absolute inset-x-3 top-3 z-10">
        <SegmentBar
          segments={segments}
          beats={reel.beats}
          time={filled ? (started ? clock : undefined) : progress}
          state={filled && !started ? 'filled' : 'playing'}
          layout="time"
          decorative
        />
      </div>
      {compact ? null : (
        <span className="absolute bottom-4 left-3 z-10 inline-flex max-w-[calc(100%-4.5rem)] items-center gap-1.5 rounded-pill bg-teal-soft px-2.5 py-1 type-caption font-semibold text-teal-strong shadow-sticker">
          <ICONS.clip aria-hidden strokeWidth={ICON_STROKE} className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap">{roll.label}</span>
        </span>
      )}
      {filled ? (
        <button
          type="button"
          onClick={() => setIntent(playing ? 'paused' : 'playing')}
          aria-label={playing ? 'Pause your version' : 'Play your version'}
          data-slot="reel-control"
          className={cn(
            'absolute z-20 inline-grid size-9 place-items-center rounded-pill bg-viewer/70 text-viewer-ink transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out)',
            'hover:bg-viewer/90 active:scale-[0.96] motion-reduce:active:scale-100',
            compact ? 'right-2 bottom-2' : 'right-3 bottom-3',
          )}
        >
          {playing ? (
            <ICONS.pause aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
          ) : (
            <ICONS.play aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
          )}
        </button>
      ) : null}
    </div>
  );
}
