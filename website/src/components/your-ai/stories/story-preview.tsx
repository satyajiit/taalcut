// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: story preview · mode: Persuade · system: WEB2 Remix Vernacular
 * states: resting (a neighbour of the open story: its footage dimmed under a heavier scrim, its author centred) ·
 *   hover (the scrim lifts a step, a fine pointer only) · pressed (opens that story, which plays). Pointer only and
 *   hidden from assistive technology: the tray's buttons open the same stories by keyboard. motion: the scrim
 *   cross-fades on the tokens' short duration; none under reduced motion.
 * The stories either side of the open one, smaller, as a stories viewer shows them on a wide screen: what comes before
 * and after, and a way to it. */

import { frameOf, spriteStyle } from '#components/showcase/frames';
import type { AiStory } from '#content/ai-stories';
import { cn } from '#lib/cn';
import { StoryAvatar } from './story-avatar';

export function StoryPreview({ story, onOpen, className }: { readonly story: AiStory; readonly onOpen: () => void; readonly className?: string }) {
  const still = frameOf(story.clip);
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onOpen}
      data-slot="story-preview"
      data-story={story.id}
      className={cn('group relative aspect-[9/16] shrink-0 cursor-pointer overflow-hidden rounded-[1.25rem] bg-viewer shadow-reel', className)}
    >
      {still !== undefined ? <span className="absolute inset-0 block" style={spriteStyle(still)} /> : null}
      <span className="absolute inset-0 bg-viewer/70 transition-[background-color] duration-(--dur-short) group-hover:bg-viewer/55 motion-reduce:transition-none" />
      <span data-slot="icon-text" className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 text-center">
        <StoryAvatar provider={story.provider} ring={story.ring} size="sm" />
        <span className="max-w-full truncate type-label-sm font-semibold text-viewer-ink">{story.provider.name}</span>
      </span>
    </button>
  );
}
