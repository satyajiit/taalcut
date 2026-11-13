// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the video made from an idea, and its post · mode: Operate · system: WEB2 Remix Vernacular (the ink
 *   pill is the window's go-ahead; teal is yours; success for what is done)
 * Products › Taalcut › Publishing (product-publishing.tsx, product-publishing-copy.tsx), led by the video: the idea
 *   you chose, playing as a 9:16 reel of the owner's footage with its post's channel on top and its hook at its
 *   foot; under it, Review, then publish: the post's state, its time, its words, the 4K master, and Approve this
 *   post and schedule. Nothing goes out until it is approved, and then through Postiz.
 * states: the video: creating (a dashed 9:16 frame, the hourglass) · ready (playing; paused by the visitor, off
 *   screen, or under reduced motion until Play) · the post: arriving · awaiting approval · approved and queued ·
 *   scheduled (each said once to screen readers) · Approve: default, hover, focus, active, disabled while the video
 *   is being made
 * motion: the frame and the post fade in; reduced motion: the 150 ms fade */

import { Calendar, Check, CircleCheck, FileVideo, Hourglass } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { ClipReel } from './clip-reel';
import { captionOf, featureName, fileOf, type Idea, POST, POST_STATUS, type PostStatus } from './ideas';
import { INK_PILL } from './ink';

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: DUR.short, ease: EASE_OUT } };

function Frame({ idea, ready }: { readonly idea: Idea; readonly ready: boolean }) {
  return (
    <div className="relative mx-auto w-full max-w-[17rem]">
      <AnimatePresence initial={false} mode="popLayout">
        {ready ? (
          <motion.div key={idea.id} {...FADE}>
            <ClipReel clipId={idea.clipId} label={`Your video: ${idea.hook}, on the owner’s footage`}>
              <span className="absolute top-3 left-3 inline-flex max-w-[calc(100%-4rem)] items-center gap-1.5 rounded-pill bg-viewer/70 px-2.5 py-1 type-caption font-semibold text-viewer-ink">
                <BrandIcon id="instagram" className="size-3.5 shrink-0" />
                <span className="truncate">{POST.account}</span>
              </span>
              <span className="absolute inset-x-4 bottom-4 flex flex-col gap-1.5">
                <span className="type-card-title leading-tight font-bold text-balance text-viewer-ink">{idea.hook}</span>
                <span className="flex items-center justify-between gap-2 type-caption text-viewer-ink/85">
                  <span className="truncate">{featureName(idea)}, in Taalcut</span>
                  <span className="tc-mono shrink-0">0:{String(idea.seconds).padStart(2, '0')}</span>
                </span>
              </span>
            </ClipReel>
          </motion.div>
        ) : (
          <motion.span
            key="creating"
            {...FADE}
            className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-reel border-[1.5px] border-dashed border-rule-strong bg-sunken text-ink-2"
          >
            <Hourglass aria-hidden className="size-5" />
            <span className="type-label">Creating video</span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export function YourVideo({
  idea,
  video,
  post,
  status,
  onApprove,
}: {
  readonly idea: Idea;
  readonly video: 'none' | 'making' | 'ready';
  /** Whether the post has arrived. */
  readonly post: boolean;
  readonly status: PostStatus;
  readonly onApprove: () => void;
}) {
  const ready = video === 'ready';
  const Done = status === 'waiting' ? Hourglass : CircleCheck;
  return (
    <section aria-label="Publishing" className="flex min-w-0 flex-col gap-4">
      <Frame idea={idea} ready={ready} />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h4 className="m-0 type-card-title text-ink">Review, then publish</h4>
          <p className="m-0 type-meta text-pretty text-ink-2">Publication uses your connected Postiz account after approval.</p>
        </div>
        <AnimatePresence initial={false}>
          {post && ready ? (
            <motion.article key={`${idea.id}-post`} {...FADE} data-post={status} className="flex min-w-0 flex-col gap-2.5">
              <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-label text-ink">
                <span data-slot="icon-text" className="inline-flex items-center gap-1.5">
                  <BrandIcon id="instagram" className="size-4" />
                  {POST.platform}
                </span>
                <span role="status" className={cn('inline-flex items-center gap-1 type-label-sm', status === 'waiting' ? 'text-ink-2' : 'text-success-strong')}>
                  <Done aria-hidden className="size-3.5" />
                  {POST_STATUS[status]}
                </span>
              </p>
              <p className="m-0 flex items-center gap-1.5 type-meta text-ink tabular-nums">
                <Calendar aria-hidden className="size-3.5 shrink-0 text-ink-2" />
                {POST.when} · {POST.timezone}
              </p>
              <p className="m-0 line-clamp-3 type-meta text-pretty text-ink-2">{captionOf(idea)}</p>
              <p className="m-0 flex min-w-0 gap-1.5 type-caption text-ink-2">
                <FileVideo aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 tabular-nums [overflow-wrap:anywhere]">
                  {fileOf(idea)} · {POST.master}
                </span>
              </p>
              {status === 'waiting' ? (
                <button type="button" className={cn(INK_PILL, 'w-full')} onClick={onApprove}>
                  <Check aria-hidden className="size-4" />
                  Approve this post and schedule
                </button>
              ) : (
                <p className="m-0 type-meta text-pretty text-ink-2">Postiz holds the approved time and posts it then. Nothing else goes out without your approval.</p>
              )}
            </motion.article>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
