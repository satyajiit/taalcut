// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: hero reel · mode: Persuade (the saved reel, Reels vernacular) · system: WEB2 Remix Vernacular
 * The saved reel playing in its 28 px frame as Reels plays one: a scrim under the 13-slot violet strip and its part
 * names, the Saved reel / Your version tabs clear below the strip (white on a dark pill, so they read on the brightest frame), the right rail of actions, the
 * Original audio row running the reel's name, Use template at its foot, fact stickers on its edge, and Kaatu in front
 * of the frame, peeking round its left bezel, head and paw over the edge.
 * states: shelf (playing under its bar) · lift (the bar rises off the reel) · the template taken (a fresh bar stays on
 *   the reel while the copy flies) · approved (Your version plays under the same bar) · toggle: default · hover ·
 *   focus (base ring) · pressed (the shown version, underlined) · unavailable (Your version before Approve:
 *   aria-disabled, dimmed) · Use template: default · hover · focus · active (3 % give) · paused / playing (the frame's
 *   control, which pauses the pass too) · stickers: absent until the pass reaches their fact, then each pops in on the
 *   world's spring (13 slots as the template lands, 22 music beats once they are read, Your version when Approve
 *   opens) and leans toward the pointer · Kaatu: peeks, dances to the reel's music beats while it plays (still once
 *   the visitor pauses, and under reduced motion), cheers on Approve, takes a poke · Your version before Approve (a
 *   lock beside it, white like the other tab) · the audio row (runs while the reel plays) · reduced motion (the
 *   finished state, 150 ms fades, no autoplay) · without JavaScript (the poster, the bar, every word, the stickers at
 *   rest) */

import { LayoutGrid, Lock, Music } from 'lucide-react';
import { AnimatePresence, motion, type MotionValue } from 'motion/react';
import { type CSSProperties, type ReactNode, useCallback } from 'react';
import { Kaatu } from '#components/kaatu/kaatu';
import { ReelFrame } from '#components/ui/reel-frame';
import { Sticker, type StickerField } from '#components/ui/sticker';
import type { Reel } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { POP, REDUCED_FADE } from '#lib/motion';
import type { DemoPhase, DemoView } from '#stores/demo';
import { DEMO } from '#components/hero/copy';
import { beatIndexAt, reached } from './pass';
import { AudioRow, ReelRail, ReelScrims } from './reel-chrome';
import { TemplateBar } from './template-bar';
import { VersionLayer } from './version-layer';

export interface HeroReelProps {
  readonly reel: Reel;
  readonly phase: DemoPhase;
  readonly view: DemoView;
  readonly run: number;
  readonly barLanded: boolean;
  readonly reelTime: MotionValue<number>;
  readonly videoPlaying: boolean;
  readonly picks: readonly string[];
  readonly stills: readonly CSSProperties[];
  readonly reduce: boolean;
  readonly onUseTemplate: () => void;
  readonly onView: (view: DemoView) => void;
  readonly onPlayingChange: (playing: boolean) => void;
  /** The visitor pressed the reel's Pause (true) or Play (false). */
  readonly onPausedChange: (paused: boolean) => void;
  readonly className?: string;
}

interface StickerSpec {
  readonly key: 'beats' | 'slots' | 'yours';
  readonly field: StickerField;
  readonly icon: typeof Music;
  readonly tilt: number;
  readonly place: string;
}

/** Top to bottom on the reel's right edge, as the comp hangs them: under the tabs, above the rail. From 1280 px they
 *  hang only a little past the edge, where the app window starts 20 px on. */
const STICKERS: readonly StickerSpec[] = [
  { key: 'beats', field: 'pink', icon: Music, tilt: -6, place: 'top-[29%] translate-x-[38%] max-sm:translate-x-[14%] xl:translate-x-[22%]' },
  { key: 'slots', field: 'violet', icon: LayoutGrid, tilt: 4, place: 'top-[39%] translate-x-[46%] max-sm:translate-x-[18%] xl:translate-x-[24%]' },
  { key: 'yours', field: 'teal', icon: ICONS.make, tilt: -4, place: 'top-[49%] translate-x-[34%] max-sm:translate-x-[12%] xl:translate-x-[20%]' },
];

function stickerWords(key: StickerSpec['key'], reel: Reel): string {
  if (key === 'beats') return DEMO.stickers.beats(reel.beats.length);
  if (key === 'slots') return DEMO.stickers.slots(reel.slots.length);
  return DEMO.stickers.yours;
}

/** Whether the pass has reached a sticker's fact. */
function stickerShown(key: StickerSpec['key'], phase: DemoPhase, barLanded: boolean): boolean {
  if (key === 'slots') return reached(phase, 'template') && barLanded;
  if (key === 'beats') return reached(phase, 'sift');
  return reached(phase, 'ready');
}

function Stickers({ reel, phase, barLanded, reduce }: { readonly reel: Reel; readonly phase: DemoPhase; readonly barLanded: boolean; readonly reduce: boolean }) {
  return (
    <AnimatePresence>
      {STICKERS.filter((s) => stickerShown(s.key, phase, barLanded)).map((s) => (
        <motion.span
          key={s.key}
          data-sticker={s.key}
          className={cn('absolute right-0', s.place)}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: POP.scale, rotate: s.tilt >= 0 ? POP.turn : -POP.turn }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.8, transition: { duration: REDUCED_FADE } }}
          transition={reduce ? { duration: REDUCED_FADE } : POP.spring}
        >
          <Sticker field={s.field} icon={s.icon} tilt={s.tilt} pop={false}>
            {stickerWords(s.key, reel)}
          </Sticker>
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** The stickers at rest, for a visitor without JavaScript (the pass never runs for them). */
function StillStickers({ reel }: { readonly reel: Reel }) {
  return (
    <noscript>
      {STICKERS.map((s) => (
        <span key={s.key} className={cn('absolute right-0', s.place)}>
          <Sticker field={s.field} icon={s.icon} tilt={s.tilt} pop={false} drift={false}>
            {stickerWords(s.key, reel)}
          </Sticker>
        </span>
      ))}
    </noscript>
  );
}

function ViewToggle({ view, approved, onView }: { readonly view: DemoView; readonly approved: boolean; readonly onView: (view: DemoView) => void }) {
  return (
    <div role="group" aria-label={DEMO.viewGroup} data-slot="view-toggle" className="mx-auto flex w-fit justify-center gap-1 rounded-pill bg-viewer/45 px-1.5 py-0.5">
      {(['saved', 'yours'] as const).map((v) => {
        const on = view === v;
        const unavailable = v === 'yours' && !approved;
        return (
          <button
            key={v}
            type="button"
            data-view={v}
            aria-pressed={on}
            aria-disabled={unavailable || undefined}
            onClick={() => {
              if (!unavailable) onView(v);
            }}
            className={cn(
              'relative inline-flex min-h-7 items-center gap-1 rounded-sm px-1.5 type-label-sm text-viewer-ink [text-shadow:0_1px_3px_var(--color-viewer),0_0_8px_var(--color-viewer)]',
              'transition-opacity duration-(--dur-micro)',
              on ? 'font-bold' : 'font-medium',
              unavailable ? 'cursor-not-allowed' : !on && 'hover:opacity-80',
            )}
          >
            {unavailable ? <Lock aria-hidden strokeWidth={ICON_STROKE + 0.25} className="size-3.5 [filter:drop-shadow(0_1px_2px_var(--color-viewer))]" /> : null}
            {DEMO.views[v]}
            <AnimatePresence initial={false}>
              {on ? (
                <motion.span
                  key="underline"
                  aria-hidden
                  className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-pill bg-viewer-ink"
                  initial={{ opacity: 0, scaleX: 0.3 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0, scaleX: 0.3 }}
                  transition={{ duration: 0.22 }}
                />
              ) : null}
            </AnimatePresence>
          </button>
        );
      })}
    </div>
  );
}

function UseTemplate({ onPress }: { readonly onPress: () => void }) {
  return (
    <button
      type="button"
      data-slot="use-template"
      onClick={onPress}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-pill bg-canvas px-4 type-label font-semibold whitespace-nowrap text-ink shadow-sticker',
        'transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:scale-[0.97] motion-reduce:active:scale-100',
      )}
    >
      <ICONS.template aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-violet-strong" />
      {DEMO.useTemplate}
    </button>
  );
}

export function HeroReel(props: HeroReelProps): ReactNode {
  const { reel, phase, view, run, barLanded, reelTime, videoPlaying, picks, stills, reduce, onUseTemplate, onView, onPlayingChange, onPausedChange, className } =
    props;
  // Kaatu dances to the reel's own music beats: the reel's clock crossing a beat is a bop. The clock only runs while
  // the video plays, so a Pause stills it; under reduced motion Kaatu never dances.
  const onBeats = useCallback(
    (onBeat: () => void) => {
      let last = beatIndexAt(reel, reelTime.get());
      return reelTime.on('change', (sec) => {
        const at = beatIndexAt(reel, sec);
        if (at === last) return;
        last = at;
        if (at >= 0) onBeat();
      });
    },
    [reel, reelTime],
  );
  // Lifted from the moment the pass takes the template until its copy lands in the window.
  const lifted = phase === 'lift' || (phase === 'template' && !barLanded);
  const approved = phase === 'approved';
  return (
    <div data-slot="hero-reel" data-view={view} className={cn('relative', className)}>
      {/* In front of the frame, round its left bezel: the peek's drawing grips an edge on its left, so it is drawn
          mirrored (each atlas layer, not the notes) to grip the reel's left edge, head and paw over it. */}
      <Kaatu
        pose={approved ? 'cheer' : 'peek-left'}
        interactive
        beat={onBeats}
        size={176}
        className="absolute top-[44%] left-0 z-30 -translate-x-[46%] max-sm:top-[21%] max-sm:[--kaatu-size:9rem] [&_.tc-kaatu-layer]:-scale-x-100"
      />
      <ReelFrame
        sources={reel.reference}
        poster={reel.poster}
        label={view === 'yours' ? DEMO.yourReel(reel.title) : DEMO.savedReel(reel.title)}
        time={reelTime}
        control="bottom-left"
        onPlayingChange={onPlayingChange}
        onPausedChange={onPausedChange}
        className="z-10"
        bar={
          <div className="flex flex-col gap-4">
            <TemplateBar key={`reel-${run}`} reel={reel} tone="video" state={lifted ? 'lifted' : 'playing'} time={reelTime} beats={reel.beats} flight="from" />
            <ViewToggle view={view} approved={approved} onView={onView} />
          </div>
        }
        bottom={<UseTemplate onPress={onUseTemplate} />}
        stickers={
          <>
            <Stickers reel={reel} phase={phase} barLanded={barLanded} reduce={reduce} />
            <StillStickers reel={reel} />
          </>
        }
      >
        {/* Mounted once the pass is ready (its loops load then), so the server HTML holds nothing hidden. */}
        {reached(phase, 'ready') ? (
          <VersionLayer reel={reel} picks={picks} stills={stills} clock={reelTime} shown={view === 'yours'} playing={videoPlaying} load reduce={reduce} />
        ) : null}
        <ReelScrims cover={reached(phase, 'ready') && view === 'yours'} />
        <ReelRail className="absolute right-2.5 bottom-18" />
        <AudioRow title={reel.title} running={videoPlaying && !reduce} className="absolute right-14 bottom-18 left-3.5" />
      </ReelFrame>
    </div>
  );
}
