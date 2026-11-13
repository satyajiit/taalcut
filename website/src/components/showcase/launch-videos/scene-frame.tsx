// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a launch video's scene, framed · mode: Operate · system: WEB2 Remix Vernacular
 * one scene of the Taalcut launch as production made it, in one output format: the scene's words on screen, large and
 *   tight, beside or over its picture, built from the site's own material (the saved reel's poster and its slot strip,
 *   its music beats, clips from the owner's camera roll at their own 9:16, the cut checked slot by slot, the ink
 *   Approve, the four-colour logo). Each scene sits on its own sticker field. Landscape and square set the words
 *   beside the picture; portrait and 4:5 stack them. The words scale with the frame (container units) and never fall
 *   under 11 px
 * states: a format (16:9, 9:16, 1:1, 4:5) · named (an image named for its scene and format) or decorative (hidden:
 *   its words are beside it) · live (the video is playing: the picture drifts in, transform only) · still (the server
 *   HTML, paused, reduced motion)
 * The footage is the owner's (camera roll frames, the poster of "Vietnam, on repeat"), never stretched. */

import { Check, MousePointer2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Logo } from '#components/brand/logo';
import { SegmentBar } from '#components/ui/segment-bar';
import { reelById } from '#content/reels';
import { cn } from '#lib/cn';
import { ClipFrame, PosterFrame } from '../frame';
import { frameOf } from '../frames';
import { reelSegments } from '../reel-side';
import type { Aspect, Scene, SceneLook } from './story';

/** Each scene's sticker field: pastel with its own ink in both themes, so the words always read. */
export const SCENE_FIELD: Readonly<Record<SceneLook, string>> = {
  hook: 'bg-sticker-violet text-sticker-violet-ink',
  read: 'bg-sticker-pink text-sticker-pink-ink',
  pick: 'bg-sticker-teal text-sticker-teal-ink',
  check: 'bg-sticker-sky text-sticker-sky-ink',
  approve: 'bg-sticker-lime text-sticker-lime-ink',
  close: 'bg-sticker-paper text-sticker-paper-ink',
};

/** Each scene's field alone, for its dot in the script and its block in the bar. */
export const SCENE_DOT: Readonly<Record<SceneLook, string>> = {
  hook: 'bg-sticker-violet',
  read: 'bg-sticker-pink',
  pick: 'bg-sticker-teal',
  check: 'bg-sticker-sky',
  approve: 'bg-sticker-lime',
  close: 'bg-sticker-paper',
};

const SHAPE: Readonly<Record<Aspect, string>> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
  '4:5': 'aspect-[4/5]',
};

/** Whether a format stacks the words under the picture (the tall ones) or sets them beside it. */
export function stacks(aspect: Aspect): boolean {
  return aspect === '9:16' || aspect === '4:5';
}

/** The words' size: a share of the frame's width, so they fill the same room in every format, never under 11 px. */
const WORDS: Readonly<Record<Aspect, string>> = {
  '16:9': 'text-[max(11px,5.6cqw)]',
  '9:16': 'text-[max(11px,9cqw)]',
  '1:1': 'text-[max(11px,7.2cqw)]',
  '4:5': 'text-[max(11px,7.8cqw)]',
};

/** Footage at its own 9:16, as large as the picture's box allows (the box is a size container). */
const FIT = 'w-[min(100cqw,56.25cqh)]';

/** The saved reel the launch shows: the third one, so this page's footage isn't the home's. */
const REEL = reelById('repeat');

/** The clips the pick scene numbers, one a slot: a day view, a city landmark, the flight. */
const PICKED = ['repeat-07', 'vietnam-09', 'airport-01'];

/** The cut checked slot by slot: four of the owner's clips, each with the AI's tick. */
const CHECKED = ['repeat-01', 'vietnam-10', 'repeat-08', 'airport-02'];

function Picture({ look }: { readonly look: SceneLook }) {
  if (look === 'hook' || look === 'read') {
    return (
      <span className={cn('relative block', FIT)}>
        <PosterFrame src={REEL.poster} className="w-full rounded-[7cqmin] shadow-sticker" />
        <span className="absolute inset-x-[9%] top-[5%]">
          <SegmentBar decorative segments={reelSegments(REEL)} beats={look === 'read' ? REEL.beats : undefined} state="filled" />
        </span>
      </span>
    );
  }
  if (look === 'pick') {
    return (
      <span className="flex items-end justify-center gap-[4cqw]">
        {PICKED.map((id, i) => (
          <span key={id} className={cn('relative block', i === 1 ? 'w-[min(32cqw,57cqh)]' : 'w-[min(27cqw,48cqh)]')}>
            <ClipFrame sprite={frameOf(id)} className="w-full rounded-[5cqmin] shadow-sticker" />
            <span className="absolute -top-[6cqmin] left-1/2 inline-grid size-[max(16px,13cqmin)] -translate-x-1/2 place-items-center rounded-pill bg-violet text-[max(11px,7cqmin)] leading-none font-bold text-violet-ink">
              {i + 1}
            </span>
          </span>
        ))}
      </span>
    );
  }
  if (look === 'check') {
    return (
      <span className="flex w-[min(100cqw,170cqh)] items-end justify-center gap-[3cqw]">
        {CHECKED.map((id) => (
          <span key={id} className="relative block w-[min(22cqw,39cqh)]">
            <ClipFrame sprite={frameOf(id)} className="w-full rounded-[4cqmin] shadow-sticker" />
            <span className="absolute -bottom-[5cqmin] left-1/2 inline-grid size-[12cqmin] -translate-x-1/2 place-items-center rounded-pill bg-violet text-violet-ink shadow-sticker">
              <Check strokeWidth={3.25} className="size-[60%]" />
            </span>
          </span>
        ))}
      </span>
    );
  }
  if (look === 'approve') {
    return (
      <span className="relative inline-flex items-center gap-[3cqmin] rounded-pill bg-inverse px-[10cqmin] py-[5cqmin] text-[max(11px,10cqmin)] leading-none font-bold text-on-inverse shadow-sticker">
        <Check strokeWidth={3} className="size-[1em]" />
        Approve
        <MousePointer2 className="absolute -right-[9cqmin] -bottom-[11cqmin] size-[16cqmin] fill-raised text-ink" />
      </span>
    );
  }
  return <Logo kind="horizontal" colourway="four-colour" className="h-[min(24cqw,36cqh)] max-w-full" />;
}

export function SceneFrame({
  scene,
  words,
  aspect,
  label,
  live = false,
  className,
}: {
  readonly scene: Scene;
  /** The words on screen, if they differ from the scene's (the version production made). */
  readonly words?: string;
  readonly aspect: Aspect;
  /** Names the frame as an image; without it the frame is decoration. */
  readonly label?: string;
  /** The video is playing: the picture drifts in over the scene's length. */
  readonly live?: boolean;
  readonly className?: string;
}) {
  const tall = stacks(aspect);
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-aspect={aspect}
      data-scene={scene.id}
      className={cn(
        '@container relative flex overflow-hidden rounded-lg p-[5%]',
        SHAPE[aspect],
        SCENE_FIELD[scene.look],
        tall ? 'flex-col items-stretch gap-[5%]' : 'flex-row items-center gap-[5%]',
        className,
      )}
    >
      <motion.span
        initial={false}
        animate={live ? { scale: [0.94, 1] } : { scale: 1 }}
        transition={live ? { duration: Math.min(scene.seconds, 4), ease: [0.16, 1, 0.3, 1] } : { duration: 0 }}
        className={cn('flex min-h-0 items-center justify-center [container-type:size]', tall ? 'h-[58%] w-full' : 'order-2 h-[88%] w-[44%] shrink-0')}
      >
        <Picture look={scene.look} />
      </motion.span>
      <span
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center',
          tall ? 'text-center' : 'text-start',
          scene.look === 'close' && 'items-center text-center',
        )}
      >
        <span className={cn('block leading-[1.02] font-extrabold tracking-[-0.03em] text-balance', WORDS[aspect])}>{words ?? scene.words}</span>
      </span>
    </div>
  );
}
