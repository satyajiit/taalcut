// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: reel frame · mode: Persuade · system: WEB2 Remix Vernacular
 * states: poster (before it plays, without JavaScript, and when the video can't load) · playing (on screen, tab shown)
 *   · paused (off screen, tab hidden, or the visitor pressed Pause: held paused until they press Play) · reduced motion
 *   (never plays on its own; Play still works) · the control: default · hover · focus (the base ring) · active (a 4 %
 *   give) · its icon and name say what a press does (Pause the reel / Play the reel), and onPausedChange tells the
 *   page what the visitor chose
 * A 9:16 reel in the world's 28 px frame: full-bleed video, muted and inline, with a poster. Slots: the SegmentBar
 * on top (`bar`), stickers on its edge (`stickers`, not clipped by the frame), and a bottom pill (`bottom`, e.g. Use
 * template). It writes the video's time into `time` while it plays, so a SegmentBar can fill from it. */

import { type MotionValue } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import type { MediaSource } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { reelControlLabel, type ReelIntent, reelShouldPlay } from './reel-play';

export interface ReelFrameProps {
  /** The video's sources, best first (media.gen.ts via #content/reels). */
  readonly sources: readonly MediaSource[];
  readonly poster: string;
  /** What the video shows, for assistive technology ("A saved reel: Vietnam, walking away on every beat"). */
  readonly label: string;
  /** Written with the video's current time, in seconds, while it plays. */
  readonly time?: MotionValue<number>;
  readonly bar?: ReactNode;
  readonly stickers?: ReactNode;
  readonly bottom?: ReactNode;
  /** More layers over the video, under the bar (a caption, Kaatu peeking). */
  readonly children?: ReactNode;
  /** Plays on its own when on screen (default). */
  readonly autoPlay?: boolean;
  readonly loop?: boolean;
  /** Where the Pause/Play control sits. */
  readonly control?: 'top-right' | 'bottom-left';
  /** Every time the video starts or stops, for whatever reason (on screen, the tab, the visitor). */
  readonly onPlayingChange?: (playing: boolean) => void;
  /** The visitor's own press on the control: true for Pause, false for Play. A reel whose autoplay was blocked reads
   *  its first press as Play. */
  readonly onPausedChange?: (paused: boolean) => void;
  readonly className?: string;
}

export function ReelFrame({
  sources,
  poster,
  label,
  time,
  bar,
  stickers,
  bottom,
  children,
  autoPlay = true,
  loop = true,
  control = 'top-right',
  onPlayingChange,
  onPausedChange,
  className,
}: ReelFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotionPref();
  const [intent, setIntent] = useState<ReelIntent>('auto');
  const [onScreen, setOnScreen] = useState(false);
  const [tabShown, setTabShown] = useState(true);
  const [playing, setPlaying] = useState(false);
  const shouldPlay = reelShouldPlay({ intent, autoPlay, reduce, onScreen, tabShown });

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

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // React sets `muted` as a property, after the HTML: set it before asking to play, or autoplay is refused.
    v.muted = true;
    if (shouldPlay) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [shouldPlay]);

  // A new reel's files (the shelf, `?reel=`): changing a <source> doesn't load it, so load the new one, and carry on
  // playing if the frame was. Without this the frame keeps playing the reel it started with.
  const files = sources.map((s) => s.src).join(' ');
  const loaded = useRef(files);
  const playNow = useRef(shouldPlay);
  playNow.current = shouldPlay;
  useEffect(() => {
    const v = video.current;
    if (!v || loaded.current === files) return;
    loaded.current = files;
    v.load();
    time?.set(0);
    if (playNow.current) void v.play().catch(() => setPlaying(false));
  }, [files, time]);

  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    let frame = 0;
    const tick = () => {
      time?.set(v.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      onPlayingChange?.(true);
      if (time && !frame) frame = window.requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      onPlayingChange?.(false);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      time?.set(v.currentTime);
    };
    v.addEventListener('playing', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    return () => {
      v.removeEventListener('playing', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [time, onPlayingChange]);

  const Glyph = playing ? ICONS.pause : ICONS.play;
  return (
    <div ref={root} data-slot="reel-frame" data-playing={playing || undefined} className={cn('relative aspect-[9/16] w-full', className)}>
      <div className="absolute inset-0 overflow-hidden rounded-reel bg-viewer shadow-reel">
        <video
          ref={video}
          aria-label={label}
          poster={poster}
          muted
          playsInline
          loop={loop}
          preload="metadata"
          disablePictureInPicture
          className="absolute inset-0 size-full object-cover"
        >
          {sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
        {/* A scrim under the bar and the pill, so white on the picture always reads. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-viewer/55 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-viewer/55 to-transparent" />
        {children}
        {bar ? <div className="absolute inset-x-3 top-3 z-10">{bar}</div> : null}
        {bottom ? <div className="absolute inset-x-3 bottom-4 z-10 flex justify-center">{bottom}</div> : null}
        <button
          type="button"
          onClick={() => {
            setIntent(playing ? 'paused' : 'playing');
            onPausedChange?.(playing);
          }}
          aria-label={reelControlLabel(playing)}
          data-slot="reel-control"
          className={cn(
            'absolute z-20 inline-grid size-9 place-items-center rounded-pill bg-viewer/70 text-viewer-ink transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out)',
            'hover:bg-viewer/90 active:scale-[0.96] motion-reduce:active:scale-100',
            control === 'top-right' ? (bar ? 'top-12 right-3' : 'top-3 right-3') : 'bottom-4 left-3',
          )}
        >
          <Glyph aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
        </button>
      </div>
      {stickers ? <div className="pointer-events-none absolute inset-0 z-30 [&>*]:pointer-events-auto">{stickers}</div> : null}
    </div>
  );
}
