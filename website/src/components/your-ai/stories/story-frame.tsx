// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: story · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (the server HTML, reduced motion, and every rest after a run: each segment full, every fact shown) ·
 *   start (armed below the fold: the first fact only, so the run plays from there) · playing (once, on arrival, on a
 *   tap in the tray, or from Play again: the segment bar fills stories style and each fact pops in on its segment,
 *   the whole run under five seconds) · on segment k (Previous or Next: the facts up to k, the rest gone) · the
 *   controls: Previous and Next (round buttons on the frame's edges: default · hover · focus (base ring) · active (a
 *   4 % give)), the tap halves (pointer only, as stories take a tap: the left third back, the rest on), the arrow keys
 *   anywhere inside, Play again (gone under reduced motion), and ChatGPT's link sticker up to its demo.
 * motion: facts pop on the world's spring; the footage settles from 106 % over the run; reduced motion fades in 150 ms.
 * One AI as a story, in the world's 9:16 frame: the owner's footage dimmed under a scrim, the segment bar across the top
 * (one segment a fact), the provider's avatar and name as the story's author with the segment's name where a story's
 * time sits, then one fact a segment, in its source's words: the first as big words, the rest as the highlighted text
 * a story sets on sticker fields. Words over the footage sit on a 70 % scrim (4.5:1 for the viewer ink even over a white
 * frame), the rest on the fields' own inks, so all of it holds its contrast on any frame. */

import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useId, type KeyboardEvent } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { frameOf, spriteStyle } from '#components/showcase/frames';
import { STICKER_FIELDS, type StickerField } from '#components/ui/sticker';
import { SegmentBar, type Segment } from '#components/ui/segment-bar';
import { type AiStory, STORIES } from '#content/ai-stories';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { EASE_OUT, POP, REDUCED_FADE } from '#lib/motion';
import { StoryAvatar } from './story-avatar';
import { runSeconds, type StepLanding, stepFrom } from './story-model';
import { useStoryRun } from './use-story-run';

/** What the stage asks of the open story: rest finished, rest on its first fact (armed), or play. */
export interface StoryCue {
  readonly token: number;
  readonly mode: 'rest' | 'start' | 'play';
}

/** The highlighted facts' fields and tilts, in turn: decoration, never a job's colour or a state. */
const LOOKS: readonly { readonly field: StickerField; readonly tilt: number }[] = [
  { field: 'lime', tilt: -1.5 },
  { field: 'sky', tilt: 1.2 },
  { field: 'pink', tilt: -1 },
];

const BAR: readonly Segment[] = Array.from({ length: 4 }, (_, i) => ({ start: i, end: i + 1, group: 'hook' as const }));

function Fact({ story, index, ran, reduce }: { readonly story: AiStory; readonly index: number; readonly ran: boolean; readonly reduce: boolean }) {
  const segment = story.segments[index]!;
  const look = LOOKS[(index - 1) % LOOKS.length] ?? LOOKS[0]!;
  const tilt = index === 0 ? 0 : look.tilt;
  const from = reduce ? { opacity: 0, rotate: tilt } : { opacity: 0, scale: POP.scale, rotate: tilt + (tilt >= 0 ? 6 : -6) };
  const motionProps = {
    initial: ran ? from : false,
    animate: { opacity: 1, scale: 1, rotate: tilt },
    transition: reduce ? { duration: REDUCED_FADE } : POP.spring,
  } as const;
  if (index === 0)
    return (
      <motion.p
        {...motionProps}
        data-fact={index}
        className="m-0 origin-left font-extrabold tracking-[-0.025em] text-balance text-viewer-ink [font-size:clamp(1.125rem,8cqw,1.875rem)] leading-[1.08]"
      >
        {segment.words}
      </motion.p>
    );
  return (
    <motion.p {...motionProps} data-fact={index} className="m-0 max-w-[92%] origin-left [font-size:clamp(0.75rem,5.2cqw,1.125rem)] leading-[1.5]">
      <span className={cn('rounded-md px-[0.4em] py-[0.15em] font-semibold [box-decoration-break:clone] [-webkit-box-decoration-break:clone]', STICKER_FIELDS[look.field])}>
        {segment.more ? <span className="font-extrabold">{segment.words}</span> : segment.words}
        {segment.more ? (
          <>
            <br />
            <span className="font-medium">{segment.more}</span>
          </>
        ) : null}
      </span>
    </motion.p>
  );
}

export interface StoryFrameProps {
  readonly story: AiStory;
  readonly index: number;
  /** How many stories the stage holds, for Previous and Next across their ends. */
  readonly stories: number;
  readonly cue?: StoryCue;
  /** A Previous on the first fact or a Next on the last: the stage opens the neighbour. */
  readonly onLeave?: (landing: Extract<StepLanding, { kind: 'story' }>) => void;
  /** ChatGPT's link sticker, up to its demo. */
  readonly link?: string;
  /** Without controls: the server HTML's row of every story, before the stage runs. */
  readonly controls?: boolean;
  readonly id?: string;
  readonly className?: string;
}

export function StoryFrame({ story, index, stories, cue, onLeave, link, controls = true, id, className }: StoryFrameProps) {
  const reduce = useReducedMotionPref();
  const nameId = useId();
  const count = story.segments.length;
  const run = useStoryRun(count);
  const zoom = useMotionValue(1);
  const { play, show, finish } = run;

  useEffect(() => {
    if (!cue || cue.token === 0) return;
    if (cue.mode === 'play' && !reduce) play();
    else if (cue.mode === 'start' && !reduce) show(0);
    else finish();
    // Each cue once, by its token: a new token is a new ask, whatever else changed.
  }, [cue?.token]);

  useEffect(() => {
    if (!run.playing || reduce) return undefined;
    const c = animate(zoom, [1.06, 1], { duration: runSeconds(count), ease: EASE_OUT });
    return () => c.stop();
  }, [run.playing, reduce, zoom, count]);

  const step = (dir: 1 | -1) => {
    const landing = stepFrom({ at: run.at, count, index, stories }, dir);
    if (landing.kind === 'segment') show(landing.at);
    else onLeave?.(landing);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1);
  };
  const segment = story.segments[run.at]!;
  const still = frameOf(story.clip);
  const chevron =
    'absolute top-1/2 z-30 inline-grid size-10 -translate-y-1/2 place-items-center rounded-pill bg-raised text-ink shadow-sticker ring-1 ring-rule transition-[background-color,scale] duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:scale-96 motion-reduce:active:scale-100';

  return (
    <article
      id={id}
      aria-labelledby={nameId}
      data-slot="story"
      data-story={story.id}
      data-at={run.at}
      data-playing={run.playing ? 'true' : undefined}
      onKeyDown={controls ? onKeyDown : undefined}
      className={cn('@container relative aspect-[9/16] w-full shrink-0', className)}
    >
      <div className="absolute inset-0 overflow-hidden rounded-reel bg-viewer shadow-reel">
        {still !== undefined ? (
          <motion.span aria-hidden data-frame="footage" className="absolute inset-0 block" style={{ ...spriteStyle(still), scale: zoom }} />
        ) : null}
        <span aria-hidden className="absolute inset-0 bg-viewer/70" />
        <span aria-hidden className="absolute inset-x-0 top-0 h-24 bg-linear-to-b from-viewer/50 to-transparent" />
        <div className="absolute inset-x-3 top-3 z-10">
          <SegmentBar segments={BAR.slice(0, count)} time={run.time} state="playing" decorative />
        </div>
        <div className="absolute inset-x-3 top-7 z-10 flex min-w-0 items-center gap-2 pe-11">
          <span data-slot="icon-text" className="inline-flex min-w-0 items-center gap-2">
            <StoryAvatar provider={story.provider} ring={story.ring} size="xs" />
            <span id={nameId} className="min-w-0 type-label-sm leading-tight font-semibold text-viewer-ink">
              {story.provider.name}
            </span>
          </span>
          <span className="truncate type-label-sm text-viewer-ink-2 @max-3xs:hidden">{segment.label}</span>
        </div>
        <div className={cn('absolute inset-x-[7cqw] top-[4.25rem] flex flex-col items-start gap-[3.5cqw]', link ? 'bottom-20' : 'bottom-6')}>
          {story.segments.map((_, i) => (i <= run.at ? <Fact key={`${story.id}-${i}`} story={story} index={i} ran={run.ran} reduce={reduce} /> : null))}
        </div>
        {controls ? (
          <>
            {/* The tap halves, as stories take a tap: pointer only (the round buttons and the arrow keys are the keyboard's). */}
            <button type="button" tabIndex={-1} aria-hidden onClick={() => step(-1)} className="absolute inset-y-0 start-0 z-[5] w-1/3 cursor-pointer" />
            <button type="button" tabIndex={-1} aria-hidden onClick={() => step(1)} className="absolute inset-y-0 end-0 z-[5] w-2/3 cursor-pointer" />
          </>
        ) : null}
        {link ? (
          <a
            href={link}
            data-slot="story-link"
            className="absolute bottom-5 left-1/2 z-20 inline-flex h-11 -translate-x-1/2 -rotate-2 items-center gap-2 rounded-pill px-4 type-label font-semibold whitespace-nowrap shadow-sticker transition-[scale] duration-(--dur-micro) hover:scale-103 active:scale-98 motion-reduce:hover:scale-100 bg-viewer-ink text-viewer"
          >
            <BrandIcon id="openai" themeAware={false} on="light" className="size-4.5" />
            {STORIES.chatgptLink}
          </a>
        ) : null}
        {controls && !reduce ? (
          <button
            type="button"
            onClick={play}
            aria-label={STORIES.replay}
            title={STORIES.replay}
            className="absolute top-6 right-3 z-20 inline-grid size-9 place-items-center rounded-pill bg-viewer/70 text-viewer-ink transition-[background-color,scale] duration-(--dur-micro) ease-(--ease-out) hover:bg-viewer/90 active:scale-96"
          >
            <RotateCcw aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
          </button>
        ) : null}
      </div>
      {controls ? (
        <>
          <button type="button" onClick={() => step(-1)} aria-label={STORIES.previous} className={cn(chevron, '-left-5')}>
            <ChevronLeft aria-hidden strokeWidth={ICON_STROKE} className="size-5" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label={STORIES.next} className={cn(chevron, '-right-5')}>
            <ChevronRight aria-hidden strokeWidth={ICON_STROKE} className="size-5" />
          </button>
          <p aria-live="polite" className="sr-only">
            {run.ran ? STORIES.status(run.at + 1, count, segment.label) : ''}
          </p>
        </>
      ) : null}
    </article>
  );
}
