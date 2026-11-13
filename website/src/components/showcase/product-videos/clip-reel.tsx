// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a clip as a reel · mode: Persuade (footage first) · system: WEB2 Remix Vernacular
 * one of the owner's roll clips at 9:16: its still from the atlas (the server's HTML and the first paint), and over
 *   it the clip's short silent loop (#content/reels rollClipLoop), mounted once the page runs. ClipLoop is the bare
 *   picture for a card (it plays while `active`: a pointer over it, a focus in it); ClipReel is the world's reel
 *   frame round it (28 px, the reel shadow, scrims top and bottom) with its own Pause/Play, as ReelFrame has.
 * states: still (server HTML, before the loop loads, reduced motion until Play) · playing (on screen, tab shown) ·
 *   paused (off screen, tab hidden, or the visitor's Pause, which holds) · the control: default · hover · focus ·
 *   active (a 4 % give) · its icon and name say what a press does
 * motion: the loop fades in over its still once it has a frame (opacity); reduced motion: it plays only on Play */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { reelControlLabel, type ReelIntent, reelShouldPlay } from '#components/ui/reel-play';
import { rollClipLoop } from '#content/reels';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';

/** The clip's still, and its loop over it while `play`; the loop exists only once the page has run. */
export function ClipLoop({ clipId, play, className }: { readonly clipId: string; readonly play: boolean; readonly className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => setReady(false), [clipId]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    if (play) void v.play().catch(() => undefined);
    else v.pause();
  }, [play, mounted, clipId]);
  return (
    <span aria-hidden className={cn('absolute inset-0 overflow-hidden', className)}>
      <ClipFrame sprite={frameOf(clipId)} className="absolute inset-0 h-full w-full rounded-none" />
      {mounted ? (
        <video
          key={clipId}
          ref={video}
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
          disablePictureInPicture
          onLoadedData={() => setReady(true)}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-(--dur-short) ease-(--ease-out)',
            ready && play ? 'opacity-100' : 'opacity-0',
          )}
        >
          {rollClipLoop(clipId).map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      ) : null}
    </span>
  );
}

/** A clip as a playing reel in the world's frame, with Pause/Play on it. `children` lie over the picture. */
export function ClipReel({
  clipId,
  label,
  children,
  className,
}: {
  readonly clipId: string;
  /** What the reel shows, for assistive technology. */
  readonly label: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const [intent, setIntent] = useState<ReelIntent>('auto');
  const [onScreen, setOnScreen] = useState(false);
  const [tabShown, setTabShown] = useState(true);
  const play = reelShouldPlay({ intent, autoPlay: true, reduce, onScreen, tabShown });

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setOnScreen((entry?.intersectionRatio ?? 0) >= 0.5), { threshold: [0, 0.5, 1] });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setTabShown(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const Glyph = play ? ICONS.pause : ICONS.play;
  return (
    <div ref={root} data-slot="clip-reel" data-playing={play || undefined} className={cn('relative aspect-[9/16] w-full', className)}>
      <div className="absolute inset-0 overflow-hidden rounded-reel bg-viewer shadow-reel">
        <span role="img" aria-label={label} className="absolute inset-0">
          <ClipLoop clipId={clipId} play={play} />
        </span>
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-viewer/60 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-viewer/70 to-transparent" />
        {children}
        <button
          type="button"
          onClick={() => setIntent(play ? 'paused' : 'playing')}
          aria-label={reelControlLabel(play)}
          data-slot="reel-control"
          className="absolute top-3 right-3 z-20 inline-grid size-9 place-items-center rounded-pill bg-viewer/70 text-viewer-ink transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-viewer/90 active:scale-[0.96] motion-reduce:active:scale-100"
        >
          <Glyph aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
