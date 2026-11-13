// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the vibe scores and the hand-off to Edits · mode: Operate · system: WEB2 Remix Vernacular (violet is the
 *   AI; the ink pill the window's one go-ahead, the page's marigold kept for its download; teal yours)
 * VibeScores: the clips from your camera roll the AI scored with Edits' on-device vibe score as it cut, each its
 *   frame, its words and the score as a level (a three-step meter and High, Medium or Low, never a number), led by
 *   the AI mark. Not a scores screen: a tool the AI used, shown where it used it. StageCard: the finished video
 *   staged in the Edits app on this Mac, its captions still editable and the sound attached; you post from Edits.
 * states: scores: none yet (a dashed ghost and one line: Cut with AI first) · arriving (one clip at a time) · shown ·
 *   stage: waiting for a cut (disabled, said why) · default · hover · focus · active · staging (the button's words,
 *   aria-busy) · staged (a tick and one line, announced)
 * motion: each clip rises 6 px and fades in turn; the card rises once on arrival; reduced motion: at once */

import { CircleCheck, Captions, Music, Send } from 'lucide-react';
import { motion } from 'motion/react';
import { AiMark } from '#components/brand/ai-mark';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { INK_PILL } from '../product-videos/ink';
import { LEVEL_WORDS, SCORED, type Sound } from './sounds';
import type { StageStatus } from './use-shelf';

function Level({ level }: { readonly level: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-center gap-1.5 type-caption text-ink-2">
      <span aria-hidden className="inline-flex items-end gap-px">
        {(['h-1.5', 'h-2', 'h-2.5'] as const).map((h, i) => (
          <span key={h} className={cn('block w-1 rounded-[1px]', h, i < level ? 'bg-violet-strong' : 'bg-rule')} />
        ))}
      </span>
      <span className="font-semibold text-ink">{LEVEL_WORDS[level]}</span>
    </span>
  );
}

export function VibeScores({
  cut,
  shown,
  reduce,
}: {
  readonly cut: boolean;
  /** How many of the scored clips show (the arrival counts them in). */
  readonly shown: number;
  readonly reduce: boolean;
}) {
  const clips = SCORED;
  return (
    <section aria-label="Vibe scores from Edits" className="relative flex flex-col gap-2.5">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-label text-ink">
        <AiMark className="size-4 text-violet-strong" />
        Vibe scores from Edits
        <span className="type-meta font-normal text-ink-2">on this Mac, as the AI cut</span>
      </p>
      <ul
        className={cn('m-0 grid list-none grid-cols-2 gap-2 p-0 @min-[44rem]:grid-cols-4', !cut && 'invisible')}
        aria-hidden={!cut || undefined}
      >
        {clips.map((clip, i) => {
          const on = cut && i < shown;
          return (
            <motion.li
              key={clip.clipId}
              data-score={LEVEL_WORDS[clip.level]}
              className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-violet-soft p-1.5"
              initial={false}
              animate={{ opacity: on ? 1 : 0, y: on ? 0 : 6 }}
              transition={reduce || !on ? { duration: reduce ? 0.15 : 0 } : { duration: 0.32, ease: EASE_OUT }}
            >
              <span className="flex items-start gap-2">
                <ClipFrame sprite={frameOf(clip.clipId)} className="w-10 shrink-0 rounded-sm" />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="type-caption font-semibold text-ink">{clip.words}</span>
                  <span className="sr-only">Vibe score: {LEVEL_WORDS[clip.level]}</span>
                  <span aria-hidden>
                    <Level level={clip.level} />
                  </span>
                </span>
              </span>
            </motion.li>
          );
        })}
      </ul>
      {cut ? null : (
        <p className="absolute inset-x-0 top-8 bottom-0 m-0 flex items-center justify-center rounded-lg border border-dashed border-rule-strong px-4 text-center type-body text-ink-2">
          As it cuts, the AI can score your clips with Edits’ vibe score.
        </p>
      )}
    </section>
  );
}

export function StageCard({
  sound,
  cut,
  status,
  shown,
  reduce,
  onStage,
}: {
  readonly sound: Sound;
  readonly cut: boolean;
  readonly status: StageStatus;
  readonly shown: boolean;
  readonly reduce: boolean;
  readonly onStage: () => void;
}) {
  return (
    <motion.div
      data-slot="stage-card"
      data-staged={status === 'staged' || undefined}
      className="flex flex-col gap-3 rounded-xl border border-rule-subtle bg-raised p-4 shadow-xs"
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 8 }}
      transition={reduce || !shown ? { duration: reduce ? 0.15 : 0 } : { duration: 0.4, ease: EASE_OUT }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="m-0 flex items-center gap-2 type-section text-ink">
            <span data-slot="icon-text" className="contents">
              <BrandIcon id="instagram" className="size-4" />
              Stage in Instagram Edits
            </span>
          </h4>
          <p className="m-0 max-w-prose type-body text-ink-2">
            Send the clean video and its caption tracks to the Instagram Edits app on this Mac. You post it from Edits.
          </p>
        </div>
        <button
          type="button"
          disabled={!cut || status !== 'idle'}
          aria-busy={status === 'staging' || undefined}
          onClick={onStage}
          className={cn(INK_PILL, status === 'staged' && 'disabled:border-success-soft disabled:bg-success-soft disabled:text-success-strong')}
        >
          {status === 'staged' ? <CircleCheck aria-hidden className="size-4" /> : <Send aria-hidden className="size-4" />}
          {status === 'staging' ? 'Staging in Edits…' : status === 'staged' ? 'Staged' : 'Stage in Instagram Edits'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="you">
          <Captions aria-hidden />
          Captions stay editable
        </Chip>
        <Chip tone="beat">
          <Music aria-hidden />
          Sound attached: {sound.title}
        </Chip>
      </div>
      <p role="status" className="m-0 type-meta text-ink-2 empty:hidden">
        {status === 'staged'
          ? 'Staged in Instagram Edits. Open the Edits app to post it.'
          : cut
            ? ''
            : 'Cut with AI first, then stage the video here.'}
      </p>
    </motion.div>
  );
}
