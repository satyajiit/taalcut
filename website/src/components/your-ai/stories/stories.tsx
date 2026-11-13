// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: stories (tray and viewer) · mode: Persuade · system: WEB2 Remix Vernacular
 * states: without JavaScript and in the server HTML (every AI's story in one row that scrolls sideways inside itself,
 *   each finished, so every provider's facts are in the page) · the viewer once the page runs (one story open, its
 *   neighbours either side on a wide screen: one each way, two on /ai/ from 1280 px) · armed (below the fold: the open
 *   story rests on its first fact) · playing (once when a third of it arrives, under five seconds, then it rests
 *   finished) · another story (a tap in the tray or on a neighbour, Previous on a first fact, Next on a last: it opens
 *   and plays; Previous lands on the story before at rest) · Local only on (compact: the cloud AIs pause in the tray,
 *   and Taalcut's own models' story opens and plays) · reduced motion (nothing plays: every story opens finished).
 * motion: the open story arrives with a short rise; the rest is the story's own (story-frame).
 * Every AI as a story: the tray of avatars, and the open story beside its neighbours, the way a stories viewer holds
 * them. `full` is /ai/'s (a larger story, centred under the tray); `compact` is the home's (Local only beside it). */

import { motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { AI_STORIES, type AiStory } from '#content/ai-stories';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { type StoryCue, StoryFrame } from './story-frame';
import { neighbours } from './story-model';
import { StoryPreview } from './story-preview';
import { StoryTray } from './story-tray';

const SIZES = {
  full: {
    open: 'w-[min(100%,18.5rem)] sm:w-80 lg:w-[21.25rem]',
    near: 'hidden md:block w-40 lg:w-44',
    far: 'hidden xl:block w-32',
    row: 'w-64',
    reach: 2,
  },
  compact: {
    open: 'w-[min(100%,13.25rem)] sm:w-56',
    near: 'hidden sm:block w-28 xl:w-36',
    far: 'hidden',
    row: 'w-56',
    reach: 1,
  },
} as const;

export interface StoriesProps {
  readonly variant?: keyof typeof SIZES;
  /** The story open at first (and in the server HTML's lead place). */
  readonly initial: string;
  /** Local only, from the switch beside the compact viewer. */
  readonly localOnly?: boolean;
  /** Where ChatGPT's link sticker goes: its demo. */
  readonly chatgptLink: string;
  readonly className?: string;
}

interface View {
  readonly id: string;
  readonly cue: StoryCue;
}

export function Stories({ variant = 'full', initial, localOnly = false, chatgptLink, className }: StoriesProps) {
  const size = SIZES[variant];
  const stageId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(stage, { reduce, amount: 0.35 });
  const [live, setLive] = useState(false);
  const [view, setView] = useState<View>({ id: initial, cue: { token: 0, mode: 'rest' } });
  const waited = useRef(false);
  const lastLocal = useRef(localOnly);

  useEffect(() => setLive(true), []);

  const cue = (id: string, mode: StoryCue['mode']) => setView((v) => ({ id, cue: { token: v.cue.token + 1, mode } }));

  // One run when the stage arrives from below the fold; until then the open story rests on its first fact.
  useEffect(() => {
    if (arrival === 'hidden') {
      waited.current = true;
      setView((v) => ({ id: v.id, cue: { token: v.cue.token + 1, mode: 'start' } }));
      return;
    }
    if (!waited.current) return;
    waited.current = false;
    setView((v) => ({ id: v.id, cue: { token: v.cue.token + 1, mode: 'play' } }));
  }, [arrival]);

  // Local only on opens Taalcut's own models' story: what still runs.
  useEffect(() => {
    if (lastLocal.current === localOnly) return;
    lastLocal.current = localOnly;
    if (localOnly) cue('on-device', 'play');
  }, [localOnly]);

  const index = Math.max(0, AI_STORIES.findIndex((s) => s.id === view.id));
  const story = AI_STORIES[index] as AiStory;
  const near = neighbours(index, AI_STORIES.length, size.reach);
  const linkFor = (s: AiStory) => (s.provider.way === 'subscription' ? chatgptLink : undefined);
  const preview = (i: number, far: boolean) => {
    const s = AI_STORIES[i] as AiStory;
    return <StoryPreview key={`${s.id}-${far ? 'far' : 'near'}`} story={s} onOpen={() => cue(s.id, 'play')} className={far ? size.far : size.near} />;
  };

  return (
    <div data-slot="stories" data-variant={variant} className={cn('flex min-w-0 flex-col', variant === 'full' ? 'gap-6' : 'gap-3', className)}>
      <StoryTray
        stories={AI_STORIES}
        open={view.id}
        onOpen={(id) => cue(id, 'play')}
        controls={stageId}
        localOnly={localOnly}
        size={variant === 'full' ? 'md' : 'sm'}
        className={variant === 'full' ? '[&>div]:mx-auto' : undefined}
      />
      <div ref={stage} id={stageId} data-slot="story-stage" className="min-w-0">
        {live ? (
          <div className="flex items-center justify-center gap-4 sm:gap-6">
            {[...near.before].reverse().map((i, k) => preview(i, k < near.before.length - 1))}
            <motion.div
              key={story.id}
              initial={view.cue.token > 0 && !reduce ? { opacity: 0, y: 12 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.long, ease: EASE_OUT }}
              className={cn('relative shrink-0', size.open)}
            >
              <StoryFrame
                story={story}
                index={index}
                stories={AI_STORIES.length}
                cue={view.cue}
                onLeave={(landing) => cue((AI_STORIES[landing.index] as AiStory).id, landing.mode)}
                link={linkFor(story)}
              />
            </motion.div>
            {near.after.map((i, k) => preview(i, k > 0))}
          </div>
        ) : (
          // The server HTML: every story, finished, in a row of its own (the page itself never scrolls sideways).
          <div className="-mx-gutter flex snap-x snap-mandatory gap-4 overflow-x-auto px-gutter pb-2 scroll-px-gutter">
            {AI_STORIES.map((s, i) => (
              <StoryFrame key={s.id} story={s} index={i} stories={AI_STORIES.length} link={linkFor(s)} controls={false} className={cn('snap-start', size.row)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
