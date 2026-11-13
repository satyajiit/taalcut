// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: your version layer · mode: Persuade (footage first) · system: WEB2 Remix Vernacular
 * Your version on the reel, under the same bar: the reel's own `made` export when there is one, else each slot plays
 * its pick's short loop (720p, from the camera roll) on the saved reel's clock, so the two cut on the same beats. The
 * saved reel keeps playing underneath as the clock.
 * states: loading (the clips fetch once Approve is near; the slot's still shows through) · shown (crossfades in over
 *   the saved reel) · hidden (the saved reel shows) · playing · paused (with the reel: the visitor's Pause, off screen,
 *   tab hidden) · a clip missing (its still stays) · reduced motion (a 150 ms crossfade; it plays only on Play)
 * Decorative: the reel's own label says which version shows. */

import { motion, useMotionValueEvent, type MotionValue } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { rollClipLoop } from '#content/reels';
import type { Reel } from '#content/schema';
import { cn } from '#lib/cn';
import { EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { slotIndexAt } from './pass';

export interface VersionLayerProps {
  readonly reel: Reel;
  /** The clip each slot's pick comes from, in slot order. */
  readonly picks: readonly string[];
  /** Each pick's 9:16 still from the atlas, in slot order. */
  readonly stills: readonly CSSProperties[];
  /** The saved reel's clock, in seconds. */
  readonly clock: MotionValue<number>;
  readonly shown: boolean;
  /** The saved reel is playing (so this plays too). */
  readonly playing: boolean;
  /** Fetch the clips (Approve is near or done). */
  readonly load: boolean;
  readonly reduce: boolean;
}

export function VersionLayer({ reel, picks, stills, clock, shown, playing, load, reduce }: VersionLayerProps) {
  const [slot, setSlot] = useState(0);
  useMotionValueEvent(clock, 'change', (t) => {
    const next = slotIndexAt(reel, t);
    if (next !== slot) setSlot(next);
  });
  const clips = useMemo(() => [...new Set(picks.filter(Boolean))], [picks]);
  const refs = useRef(new Map<string, HTMLVideoElement>());
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const made = reel.made.length > 0;
  const current = picks[slot] ?? '';
  const active = shown && playing && load;

  useEffect(() => {
    for (const [id, video] of refs.current) {
      video.muted = true;
      if (active && (made || id === current)) {
        if (!made) video.currentTime = 0;
        video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [active, current, made]);

  const register = (id: string) => (el: HTMLVideoElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  const onReady = (id: string) => () => setReady((s) => (s.has(id) ? s : new Set([...s, id])));

  return (
    <motion.div
      aria-hidden
      data-slot="version-layer"
      data-shown={shown || undefined}
      className="pointer-events-none absolute inset-0 bg-viewer"
      initial={false}
      animate={{ opacity: shown ? 1 : 0 }}
      transition={{ duration: reduce ? REDUCED_FADE : 0.35, ease: EASE_OUT }}
    >
      <span className="absolute inset-0" style={stills[slot] ?? stills[0]} />
      {load && made ? (
        <video ref={register('made')} muted loop playsInline preload="auto" tabIndex={-1} onLoadedData={onReady('made')} className={cn('absolute inset-0 size-full object-cover', ready.has('made') ? 'opacity-100' : 'opacity-0')}>
          {reel.made.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      ) : null}
      {load && !made
        ? clips.map((id) => (
            <video
              key={id}
              ref={register(id)}
              muted
              loop
              playsInline
              preload="auto"
              tabIndex={-1}
              data-version-clip={id}
              onLoadedData={onReady(id)}
              className={cn('absolute inset-0 size-full object-cover', id === current && ready.has(id) ? 'opacity-100' : 'opacity-0')}
            >
              {rollClipLoop(id).map((s) => (
                <source key={s.src} src={s.src} type={s.type} />
              ))}
            </video>
          ))
        : null}
      {/* The frame's own scrims sit under this layer: the bar and the pill need theirs over it too. */}
      <span className="absolute inset-x-0 top-0 h-24 bg-linear-to-b from-viewer/55 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-viewer/55 to-transparent" />
    </motion.div>
  );
}
