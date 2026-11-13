// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a sound's waveform · mode: Operate (inside the showcase) · system: WEB2 Remix Vernacular (rose is the
 *   beat; violet the AI's cuts; the playhead a marigold line, never a fill)
 * the sound as bars, loud on its music beats, with each hook drop marked on a rose band and its time in seconds
 *   over it, the way the shelf's hook bar marks them; the playhead while it plays; and, once Cut with AI has run,
 *   the cuts as violet lines down the sound, every one on a beat. `mini` is a row's small rhythm bar.
 * states: still · playing (the playhead moves, the bars behind it darken, a hook's time swells as it passes) · cut
 *   (the cut lines drop in) · not cut (no lines) · reduced motion (no swell; the lines appear at once). Not a
 *   control: the buttons beside it carry the states. Read as one image with its words.
 * motion: transform and opacity only (the playhead by translateX, the lines by scaleY, the hook time by scale) */

import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { cutOf, hookLabel, hooksOf, type Sound, waveOf } from './sounds';

/** False for the server's HTML and the first render; true once the page has run (so later mounts can animate in). */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

function pct(seconds: number, duration: number): string {
  return `${((Math.min(Math.max(seconds, 0), duration) / duration) * 100).toFixed(3)}%`;
}

/** Where a label sits over a time: centred, or held inside the row near either end. */
function shift(seconds: number, duration: number): string {
  const share = seconds / duration;
  return share < 0.1 ? '-10%' : share > 0.88 ? '-90%' : '-50%';
}

/**
 * A sound's row drawn as its waveform: its bars across the row, loud on its beats, each hook drop on a rose band with
 * its time in seconds over it, and the playhead running along it while the sound plays.
 */
export function RowWave({
  sound,
  at,
  bars: count = 44,
  className,
}: {
  readonly sound: Sound;
  /** The playhead, in seconds, while this sound plays; null otherwise. */
  readonly at: number | null;
  readonly bars?: number;
  readonly className?: string;
}) {
  const duration = sound.durationSec;
  const bars = useMemo(() => waveOf(sound, count), [sound, count]);
  const drops = useMemo(() => hooksOf(sound), [sound]);
  return (
    <span aria-hidden data-slot="row-wave" className={cn('relative block', className)}>
      <span className="relative block h-4">
        {drops.map((h) => (
          <span
            key={h}
            className="absolute top-0 rounded-pill bg-rose-soft px-1.5 type-caption leading-4 font-semibold whitespace-nowrap text-rose-strong"
            style={{ left: pct(h, duration), transform: `translateX(${shift(h, duration)})` }}
          >
            <span className="tc-mono">{hookLabel(h)}</span>
          </span>
        ))}
      </span>
      <span className="relative mt-0.5 block h-7">
        {drops.map((h) => (
          <span key={h} className="absolute inset-y-0 w-2.5 -translate-x-1/2 rounded-sm bg-rose-soft" style={{ left: pct(h, duration) }} />
        ))}
        <span className="absolute inset-0 flex items-center gap-[2px]">
          {bars.map((bar, i) => (
            <span
              key={i}
              className={cn(
                'min-w-0 flex-1 rounded-pill',
                bar.hook ? 'bg-rose-strong' : at !== null && bar.at <= at ? 'bg-ink-2' : 'bg-rule-strong',
              )}
              style={{ height: `${Math.round((bar.hook ? 1 : Math.min(0.9, bar.level)) * 100)}%` }}
            />
          ))}
        </span>
        {at !== null ? (
          <span className="pointer-events-none absolute inset-0 block" style={{ transform: `translateX(${pct(at, duration)})` }}>
            <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 rounded-pill bg-playhead-strong" />
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function Waveform({
  sound,
  at,
  cut,
  hooks = true,
  reduce,
  bars: count = 72,
  className,
}: {
  readonly sound: Sound;
  /** The playhead, in seconds; null when it isn't playing or paused part way. */
  readonly at: number | null;
  /** Cut with AI has run on this sound: draw its cuts. */
  readonly cut: boolean;
  /** Show the hook drops' times (the arrival shows them once the playhead reaches the first). */
  readonly hooks?: boolean;
  readonly reduce: boolean;
  readonly bars?: number;
  readonly className?: string;
}) {
  const duration = sound.durationSec;
  const hydrated = useHydrated();
  const bars = useMemo(() => waveOf(sound, count), [sound, count]);
  const drops = useMemo(() => hooksOf(sound), [sound]);
  const cuts = useMemo(() => cutOf(sound).slice(1).map((s) => s.start), [sound]);
  const label = `${sound.title}: ${Math.round(duration)} seconds, the hook drops at ${drops.map(hookLabel).join(' and ')}${cut ? `, cut with AI on its beats` : ''}`;
  return (
    <div role="img" aria-label={label} data-slot="waveform" className={cn('relative', className)}>
      {/* The hook drops' times, over their bands. */}
      <div aria-hidden className="relative h-7">
        {drops.map((h, i) => {
          const passing = at !== null && at >= h && at - h < 0.5;
          return (
            <motion.span
              key={h}
              data-hook={hookLabel(h)}
              className="absolute bottom-1 inline-flex origin-bottom items-center gap-1 rounded-pill bg-rose-soft px-2 py-0.5 type-caption font-semibold whitespace-nowrap text-rose-strong"
              style={{ left: pct(h, duration), x: i === 0 && h / duration < 0.12 ? '-15%' : '-50%' }}
              initial={false}
              animate={{ opacity: hooks ? 1 : 0, scale: hooks ? (passing && !reduce ? 1.12 : 1) : 0.6 }}
              transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 520, damping: 22, mass: 0.7 }}
            >
              {i === 0 ? 'Hook drops ' : null}
              <span className="tc-mono">{hookLabel(h)}</span>
            </motion.span>
          );
        })}
      </div>
      <div aria-hidden className="relative h-20 overflow-hidden rounded-lg bg-sunken">
        {drops.map((h) => (
          <span
            key={h}
            className="absolute inset-y-0 w-3 -translate-x-1/2 bg-rose-soft"
            style={{ left: pct(h, duration) }}
          />
        ))}
        <div className="absolute inset-x-2 inset-y-2 flex items-center gap-px">
          {bars.map((bar, i) => {
            const played = at !== null && bar.at <= at;
            return (
              <span
                key={i}
                className={cn(
                  'min-w-0 flex-1 rounded-pill',
                  bar.hook ? 'bg-rose-strong' : played ? 'bg-ink-2' : 'bg-rule-strong',
                )}
                style={{ height: `${Math.round(bar.level * 100)}%` }}
              />
            );
          })}
        </div>
        {/* The cuts, every one on a beat, dropping in once Cut with AI has run in this browser (the server's HTML
            draws them in place, and draws none for a sound not cut yet). */}
        {cut ? (
          <div className="absolute inset-x-2 inset-y-0">
            {cuts.map((c, i) => (
              <motion.span
                key={c}
                data-cut
                className="absolute inset-y-1 w-0.5 origin-bottom -translate-x-1/2 rounded-pill bg-violet-strong"
                style={{ left: pct(c, duration) }}
                initial={hydrated ? { scaleY: 0, opacity: 0 } : false}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={reduce ? { duration: 0.15 } : { delay: i * 0.05, duration: 0.3, ease: EASE_OUT }}
              />
            ))}
          </div>
        ) : null}
        {/* The playhead: a marigold line, moved by transform. */}
        {at !== null ? (
          <span className="pointer-events-none absolute inset-x-2 inset-y-0">
            <span className="absolute inset-0 block" style={{ transform: `translateX(${pct(at, duration)})` }}>
              <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 rounded-pill bg-playhead-strong" />
            </span>
          </span>
        ) : null}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-between px-2 type-caption text-ink-3">
        <span className="tc-mono">0s</span>
        <span className="tc-mono">{Math.round(duration)}s</span>
      </div>
    </div>
  );
}
