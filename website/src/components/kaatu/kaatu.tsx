// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Kaatu · mode: Persuade (brand character) · system: WEB2 Remix Vernacular
 * states: a pose (its own drawing; plays its short act twice when it first comes on screen, then holds; the peeks
 *   slide in from their edge) · a mood (idle: blinks every 3–6 s, an antic every 8–15 s, dozes after 40 s without
 *   input and wakes with a yawn; glance, thinking, delighted, oops, asleep, wave) from the prop or a KaatuMoodProvider
 *   · interactive (a button, "Kaatu, Taalcut’s beaver: poke": the head turns to a mouse or trackpad pointer and the
 *   body leans after it; hover rests make it shy; click, tap, Enter or Space plays a poke reaction with a hop; four
 *   quick pokes make it dizzy; focus shows the global ring) · following (decoration that turns its head to a near
 *   mouse or trackpad pointer and leans after it, blinks and lives as ever, and is never focusable) · dancing (a `beat` bops it left and right with a rose
 *   music note per beat, back home when the beats stop) · sticker (white die-cut edge and the sticker shadow; peels
 *   on and settles) · off screen or tab hidden (its one requestAnimationFrame and every timer stop) · reduced motion
 *   (the still frame, no life, no following, no entrance; a poke is one calm face crossfaded in 150 ms) · without
 *   JavaScript (the still frame, decorative). Not loading, error or disabled: a frame whose atlas is still on its way
 *   waits, so nothing flashes empty.
 * The site's Kaatu API. Lanes place Kaatu with these props and a className that positions it. Decorative by default
 * (aria-hidden, never focusable): the words beside it carry the meaning. Only `interactive` makes it a control, and an
 * interactive Kaatu never sits inside an aria-hidden subtree: decoration that should still look about uses `follow`. */

import { Music, Music2 } from 'lucide-react';
import { type CSSProperties, useMemo, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { useSectionMood } from './kaatu-context';
import { breathOf, stillOf } from './kaatu-engine';
import { facing, locate, SHEET_NAMES } from './kaatu-frames';
import type { KaatuMood, KaatuToward } from './kaatu-moods';
import { POSES, type KaatuPose } from './kaatu-poses';
import { type KaatuBeat, useKaatu } from './use-kaatu';
import { type KaatuEntrance, useKaatuEntrance } from './use-kaatu-entrance';

export type { KaatuBeat, KaatuMood, KaatuPose, KaatuToward };
export { KAATU_POSES } from './kaatu-poses';
export { KaatuMoodProvider } from './kaatu-context';

/** The interactive Kaatu's accessible name. */
export const KAATU_POKE_LABEL = 'Kaatu, Taalcut’s beaver: poke';

export interface KaatuProps {
  /** A pose: its own drawing. It plays its act on arrival, then holds. Leave it out for a mood's own life. */
  readonly pose?: KaatuPose;
  /** The mood when there is no pose: this prop, else the nearest KaatuMoodProvider's, else idle. */
  readonly mood?: KaatuMood;
  /** Rendered size in px. The atlases have 480 px cells: sharp to 240 on a 2x screen. A class that sets --kaatu-size
   *  (`max-sm:[--kaatu-size:5.5rem]`) changes it at a breakpoint. */
  readonly size?: number;
  /** A button: follows the pointer, blinks, goes shy, and reacts to a poke. Never inside an aria-hidden subtree. */
  readonly interactive?: boolean;
  /** Decoration that follows a near mouse or trackpad pointer (head and lean), without being a control. */
  readonly follow?: boolean;
  /** The sticker frame (a die-cut white edge and a sticker's shadow), peeled on as it arrives. */
  readonly sticker?: boolean;
  /** Where a glance looks. */
  readonly toward?: KaatuToward;
  /** Dance to the music: a MotionValue that changes on every beat, or a subscribe function. */
  readonly beat?: KaatuBeat;
  readonly className?: string;
}

export function Kaatu({ pose, mood, size = 96, interactive = false, follow = false, sticker = false, toward = 'right', beat, className }: KaatuProps) {
  const sectionMood = useSectionMood();
  const resolved: KaatuMood = mood ?? sectionMood ?? 'idle';
  const reduce = useReducedMotionPref();
  const root = useRef<HTMLElement>(null);
  const art = useRef<HTMLSpanElement>(null);
  const slide = useRef<HTMLSpanElement>(null);
  const breath = useRef<HTMLSpanElement>(null);
  const lean = useRef<HTMLSpanElement>(null);
  const stage = useRef<HTMLSpanElement>(null);
  const notes = useRef<HTMLSpanElement>(null);
  const elements = useMemo(() => ({ root, art, stage, breath, lean, notes }), []);
  const handlers = useKaatu({ pose, mood: resolved, toward, reduce }, interactive || follow, beat, elements);

  const entrance = pose ? POSES[pose].entrance : 'in-place';
  const arrival: KaatuEntrance | null = entrance !== 'in-place' ? entrance : sticker ? 'sticker' : null;
  useKaatuEntrance(slide, arrival);

  // The server HTML, and the first render: the still frame. From then on the engine writes the frame itself.
  const still = stillOf({ pose, mood: resolved, toward });
  const place = locate(still);
  // The size prop's px, as a fallback under --kaatu-size: a caller's class can set --kaatu-size at a breakpoint.
  const sizing = { '--kaatu-px': `${size}px` } as CSSProperties;

  const drawing = (
    <span
      ref={interactive ? art : (node) => {
        art.current = node;
        root.current = node;
      }}
      aria-hidden
      data-slot="kaatu"
      data-pose={pose}
      data-mood={pose ? undefined : resolved}
      data-frame={still}
      data-facing={facing(still)}
      data-interactive={interactive || undefined}
      data-follow={(follow && !interactive) || undefined}
      data-entrance={entrance !== 'in-place' ? entrance : undefined}
      className={cn('inline-block shrink-0 select-none', interactive ? 'pointer-events-none size-full' : cn('size-[var(--kaatu-size,var(--kaatu-px))]', className))}
      style={interactive ? undefined : sizing}
    >
      <span data-slot="kaatu-entrance" className="relative block size-full">
        <span ref={slide} className="block size-full origin-bottom">
          <span
            ref={breath}
            data-slot="kaatu-breath"
            data-breath={reduce ? undefined : breathOf({ pose, mood: resolved, toward })}
            data-paused=""
            className={cn('block size-full origin-bottom', sticker && 'tc-kaatu-sticker')}
          >
            <span ref={lean} className="block size-full origin-[50%_75%]">
              <span ref={stage} className="relative block size-full origin-[50%_75%]">
                {SHEET_NAMES.map((name, sheet) => (
                  <span
                    key={name}
                    className="tc-kaatu-layer"
                    data-layer=""
                    data-sheet={sheet}
                    data-cell={sheet === place.sheet ? place.cell : 4}
                    data-on={sheet === place.sheet ? '' : undefined}
                  />
                ))}
                <span data-slot="kaatu-ghost" className="tc-kaatu-layer" />
              </span>
            </span>
          </span>
          {beat ? (
            <span ref={notes} data-slot="kaatu-notes" className="pointer-events-none absolute inset-0">
              {/* Filled heads, so the floating notes match the flat notes drawn in the bop frames. */}
              <Music className="tc-kaatu-note text-rose-strong" fill="currentColor" strokeWidth={ICON_STROKE} aria-hidden />
              <Music2 className="tc-kaatu-note text-rose-strong" fill="currentColor" strokeWidth={ICON_STROKE} aria-hidden />
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );

  if (!interactive) return drawing;
  return (
    <button
      ref={(node) => {
        root.current = node;
      }}
      type="button"
      aria-label={KAATU_POKE_LABEL}
      data-slot="kaatu-poke"
      onClick={handlers.poke}
      onPointerEnter={(event) => handlers.enter(event.pointerType === 'mouse' || event.pointerType === 'pen')}
      onPointerLeave={handlers.leave}
      onFocus={() => handlers.enter(false)}
      className={cn(
        'inline-block size-[var(--kaatu-size,var(--kaatu-px))] shrink-0 cursor-pointer touch-manipulation select-none rounded-full border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent]',
        className,
      )}
      style={sizing}
    >
      {drawing}
    </button>
  );
}
