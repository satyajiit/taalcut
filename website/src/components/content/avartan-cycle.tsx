// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Avartan cycle · mode: Persuade (the name's story) · system: WEB2 Remix Vernacular
 * states: rest (every arc full, every beat filled) · counting (one cycle of jhaptaal, 4.5 s, under the 5 s pause
 *   rule: the beats fill one by one stories style, the sounding group's arc swells and the others step back, the
 *   button says Counting and is disabled) · the button: default · hover · focus (base ring) · active (2 % give) ·
 *   disabled while counting · the symbol leans toward a mouse or trackpad pointer · reduced motion (no count on
 *   arrival; the button still counts, with the beats filling at once and 150 ms fades, no swell, no lean) · without
 *   JavaScript (rest)
 * The logo's four arcs beside one cycle of jhaptaal, ten beats in groups of two, three, two and three, each group in
 * its arc's colour with its sign and name. Counted once when it first comes into view (the About page's one
 * orchestrated moment), and again on "Count the cycle". The playhead always comes back to sam. */

import { Play } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { buttonClasses } from '#components/ui/button';
import { ABOUT, JHAPTAAL } from '#content/about';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { usePointerDrift } from '#lib/pointer';

/** The symbol's four arcs (design/logo/kit/svg/taalcut-symbol-four-colour-light.svg), clockwise from the top. */
const ARCS = [
  'M137 16.36A112 112 0 0 1 233.5 90.41L175.14 106.05A52 52 0 0 0 137 76.78Z',
  'M238.16 107.8A112 112 0 0 1 137 239.64L137 201.45A74 74 0 0 0 201.28 117.68Z',
  'M119 239.64A112 112 0 0 1 22.5 165.59L41.89 160.39A92 92 0 0 0 119 219.56Z',
  'M17.84 148.2A112 112 0 0 1 119 16.36L119 54.55A74 74 0 0 0 54.72 138.32Z',
] as const;
const ARC_FILL = ['fill-logo-1', 'fill-logo-2', 'fill-logo-3', 'fill-logo-4'] as const;
const ARC_BG = ['bg-logo-1', 'bg-logo-2', 'bg-logo-3', 'bg-logo-4'] as const;

const BEAT_MS = 450;
const BEATS = JHAPTAAL.flatMap((g) => g.beats);

export function AvartanCycle() {
  const reduce = useReducedMotionPref();
  /** The sounding beat (1–10) while counting; null at rest. */
  const [beat, setBeat] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const symbol = useRef<HTMLDivElement>(null);
  const played = useRef(false);
  const lean = usePointerDrift(symbol, { enabled: !reduce, max: 8 });

  const count = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = BEATS.map((b, i) => window.setTimeout(() => setBeat(b), i * BEAT_MS));
    timers.current.push(window.setTimeout(() => setBeat(null), BEATS.length * BEAT_MS));
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || reduce || played.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !played.current) {
          played.current = true;
          io.disconnect();
          count();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [count, reduce]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const counting = beat !== null;
  const sounding = JHAPTAAL.findIndex((g) => g.beats.includes(beat ?? 1));
  const fade = reduce ? { duration: REDUCED_FADE } : { duration: 0.22, ease: EASE_OUT };

  return (
    <div ref={root} className="grid items-center gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
      <motion.div ref={symbol} style={{ x: lean.x, y: lean.y }} className="mx-auto w-full max-w-[14rem] sm:max-w-[18rem]">
        <svg viewBox="14 14 228 228" role="img" aria-label="The Avartan: four arcs, one cycle of jhaptaal" className="w-full overflow-visible">
          {ARCS.map((d, i) => (
            <motion.path
              key={d}
              d={d}
              fillRule="evenodd"
              className={ARC_FILL[i]}
              style={{ transformBox: 'view-box', transformOrigin: '128px 128px' }}
              initial={false}
              animate={{ opacity: counting && i !== sounding ? 0.25 : 1, scale: counting && i === sounding && !reduce ? 1.07 : 1 }}
              transition={fade}
            />
          ))}
        </svg>
      </motion.div>

      <div className="flex min-w-0 flex-col gap-8">
        <ol aria-label="One cycle of jhaptaal, ten beats in four groups" className="m-0 flex list-none gap-2 p-0 sm:gap-3">
          {JHAPTAAL.map((g, gi) => (
            <li key={g.beats[0]} className="flex min-w-0 flex-col gap-2" style={{ flexGrow: g.beats.length, flexBasis: 0 }}>
              <span className={cn('flex items-baseline gap-1.5 truncate type-label text-ink transition-opacity duration-150', counting && gi !== sounding ? 'opacity-50' : '')}>
                <span className="font-extrabold tabular-nums">{g.sign}</span>
                {g.name}
              </span>
              <span className="flex gap-1">
                {g.beats.map((b) => {
                  const filled = !counting || (beat ?? 0) >= b;
                  const now = beat === b;
                  return (
                    <span key={b} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <span aria-hidden className={cn('relative block h-3 w-full overflow-hidden rounded-pill bg-rule-subtle', now && !reduce ? 'shadow-lift' : '')}>
                        <motion.span
                          className={cn('absolute inset-0 origin-left rounded-pill', ARC_BG[gi])}
                          initial={false}
                          animate={{ scaleX: filled ? 1 : 0 }}
                          transition={now && !reduce ? { duration: BEAT_MS / 1000, ease: 'linear' } : { duration: 0 }}
                        />
                      </span>
                      <span className={cn('type-meta tabular-nums', now ? 'font-bold text-ink' : 'text-ink-3')}>{b}</span>
                    </span>
                  );
                })}
              </span>
              <span className="truncate type-meta text-ink-2">{g.colour}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="button" onClick={count} disabled={counting} className={buttonClasses('secondary', 'md')}>
            <Play aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
            {counting ? ABOUT.avartan.counting : ABOUT.avartan.replay}
          </button>
          {/* The beat count is for the eye; read out ten times in 4.5 s it would only be noise. */}
          <span className="type-meta text-ink-2">
            {counting ? <span aria-hidden>{`Beat ${beat} of 10: ${JHAPTAAL[sounding]!.name}`}</span> : ABOUT.avartan.playhead}
          </span>
        </div>
      </div>
    </div>
  );
}
