// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the short, made · mode: Operate · system: WEB2 Remix Vernacular (the playhead is a marigold line, never a
 *   fill; violet is the AI's; the hook and the payoff take the slot-role hues, each with its word)
 * the portrait short the AI cut from the long video: its 9:16 preview playing the owner's footage under captions
 *   that light up word by word, Play and Pause with its time; the short as one strip of its parts in order (hook,
 *   context, payoff) with the playhead; each part as a row to play from, its words and its length; and the second
 *   check, against the original frames, with its tick. Smart reframe, an export option, follows the person
 * states: preview: making (the parts not gathered yet: a spinner on the viewer grey) · ready (paused or playing) ·
 *   Play/Pause (secondary button: default, hover, focus, active) · a part: default, hover, focus, active, playing ·
 *   check: waiting · checking (spinner) · passed (tick) · one polite status line when a short starts and when it is
 *   ready
 * motion: the parts gather into the strip in turn (scaleX from the left), the tick pops; the preview plays once after
 *   a short is made; reduced motion: the parts and the tick are there, nothing plays until Play */

import { Captions, CircleCheck, CircleDashed, Crop, LoaderCircle } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { buttonClasses } from '#components/ui/button-classes';
import { Sticker } from '#components/ui/sticker';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { frameAtTime } from '../frames';
import { SHOWCASE_ICONS } from '../icons';
import { pop } from '../vignette';
import { RoleGlyph, ROLE_LOOK } from './long-video';
import { type ShortRun, usePreview } from './short-run';
import { clock, playAt } from './trip';

function Check({ state, reduce }: { readonly state: ShortRun['check']; readonly reduce: boolean }) {
  return (
    <div data-slot="check" data-check={state} className="flex min-h-14 items-start gap-2.5 rounded-lg bg-sunken px-3 py-2.5">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={state}
          className="mt-0.5 inline-flex shrink-0"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0 } }}
          transition={pop(0, reduce)}
        >
          {state === 'passed' ? (
            <CircleCheck aria-hidden className="size-4.5 text-success-strong" />
          ) : state === 'checking' ? (
            <LoaderCircle aria-hidden className="size-4.5 text-ink-2 motion-safe:animate-spin" />
          ) : (
            <CircleDashed aria-hidden className="size-4.5 text-ink-3" />
          )}
        </motion.span>
      </AnimatePresence>
      <span className="flex flex-col gap-0.5">
        <span className="type-label text-ink">
          {state === 'passed'
            ? 'Checked against the original frames'
            : state === 'checking'
              ? 'Checking the cut against the original frames…'
              : 'A second check, once the cut is made'}
        </span>
        <span className="type-meta text-ink-2">
          A cut that fails is fixed, up to twice. If it still isn’t right, the short waits for your review.
        </span>
      </span>
    </div>
  );
}

export function ShortPreview({ run }: { readonly run: ShortRun }) {
  const reduce = useReducedMotionPref();
  const preview = usePreview(run.seconds);
  const { play, reset } = preview;
  // A new short starts from its beginning, and plays once it is made (never by itself under reduced motion).
  useEffect(() => {
    if (run.running) reset();
  }, [run.running, reset]);
  const played = useRef(0);
  useEffect(() => {
    if (run.made <= played.current) return;
    played.current = run.made;
    if (!reduce) play(0);
  }, [run.made, reduce, play]);

  const now = playAt(run.picks, preview.at);
  const ready = run.gathered > 0;
  const sprite = now ? frameAtTime(now.clipId, now.inClip) : undefined;
  const Toggle = preview.playing ? SHOWCASE_ICONS.pause : SHOWCASE_ICONS.play;

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid grid-cols-1 gap-6 @min-[40rem]:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <figure className="m-0 flex flex-col items-center gap-3 @min-[40rem]:items-stretch">
          <div className="relative w-44 @min-[40rem]:w-full">
            <div aria-hidden className="relative aspect-[9/16] w-full overflow-hidden rounded-reel bg-viewer shadow-reel">
              {ready ? (
                <ClipFrame sprite={sprite} className="absolute inset-0 size-full" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-viewer-ink-2">
                  <LoaderCircle className="size-6 motion-safe:animate-spin" />
                </span>
              )}
              {ready && now ? (
                <p className="absolute inset-x-2.5 bottom-[9%] m-0 flex flex-wrap justify-center gap-x-1 gap-y-0.5 rounded-lg bg-viewer/80 px-1.5 py-1.5 text-center type-label-sm font-bold">
                  {now.words.map((word, i) => (
                    <span
                      key={`${now.index}-${i}`}
                      className={cn('rounded-sm px-0.5', i === now.word ? 'bg-viewer-ink text-viewer' : 'text-viewer-ink')}
                    >
                      {word}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
            <span className="pointer-events-none absolute top-5 -left-3 [&>*]:pointer-events-auto">
              <Sticker field="pink" icon={Captions} tilt={-5} size="sm">
                Captions on
              </Sticker>
            </span>
          </div>
          <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <button type="button" className={buttonClasses('secondary', 'md')} disabled={!ready} onClick={preview.toggle}>
              <Toggle aria-hidden className="size-4" />
              {preview.playing ? 'Pause' : 'Play'}
            </button>
            <span className="tc-mono type-meta whitespace-nowrap text-ink-2">
              {clock(preview.at)} / {clock(run.seconds)}
            </span>
          </figcaption>
        </figure>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="me-auto type-section text-ink">Your short</span>
              <Chip>9:16</Chip>
              <Chip>{clock(run.seconds)}</Chip>
            </div>
            <div aria-hidden className="relative flex h-3 gap-0.5">
              {run.picks.map((p, i) => (
                <span key={p.line.id} className="relative h-full min-w-0 overflow-hidden rounded-pill bg-rule-subtle" style={{ flexGrow: p.line.seconds }}>
                  <motion.span
                    className={cn('absolute inset-0 origin-left rounded-[inherit] border', ROLE_LOOK[p.role].bar)}
                    initial={false}
                    animate={{ scaleX: i < run.gathered ? 1 : 0 }}
                    transition={i < run.gathered ? { duration: reduce ? 0 : DUR.long, ease: EASE_OUT } : { duration: 0 }}
                  />
                </span>
              ))}
              {ready ? (
                <span
                  className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-pill bg-playhead-strong"
                  style={{ left: `${(preview.at / Math.max(1, run.seconds)) * 100}%` }}
                />
              ) : null}
            </div>
          </div>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {run.picks.map((p, i) => {
              const look = ROLE_LOOK[p.role];
              const start = run.picks.slice(0, i).reduce((sum, q) => sum + q.line.seconds, 0);
              const playing = ready && now?.index === i;
              return (
                <li key={p.line.id}>
                  <button
                    type="button"
                    data-part={p.role}
                    aria-current={playing ? 'true' : undefined}
                    disabled={i >= run.gathered}
                    onClick={() => preview.seek(start)}
                    className={cn(
                      'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-start transition-colors duration-(--dur-micro) ease-(--ease-out)',
                      'disabled:cursor-default disabled:opacity-60',
                      playing ? 'bg-hover' : 'not-disabled:hover:bg-hover not-disabled:active:bg-pressed',
                    )}
                  >
                    <span className={cn('inline-flex w-20 shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 type-caption font-semibold [&_svg]:size-3', look.tag)}>
                      <RoleGlyph role={p.role} />
                      {look.word}
                    </span>
                    <span className="min-w-0 flex-1 truncate type-body text-ink">“{p.line.text}”</span>
                    <span className="shrink-0 tc-mono type-meta text-ink-2">{p.line.seconds} s</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Check state={run.check} reduce={reduce} />
          <p className="m-0 flex items-start gap-2 type-meta text-ink-2">
            <Crop aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
            <span>
              <span className="font-semibold text-ink">Smart reframe</span> at export follows the person in each shot.
            </span>
          </p>
          <p role="status" className="sr-only">
            {run.running ? 'Making the short.' : run.check === 'passed' ? `The short is ready: ${clock(run.seconds)}, checked against the original frames.` : ''}
          </p>
        </div>
      </div>
    </MotionConfig>
  );
}
