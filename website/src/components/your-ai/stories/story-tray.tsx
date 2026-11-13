// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: stories tray · mode: Persuade · system: WEB2 Remix Vernacular
 * states: an avatar button: default · hover (the avatar grows a hair, a fine pointer only) · focus (base ring) ·
 *   active (a 3 % give) · open (aria-pressed: the avatar lifted, its name in ink and a bar under it) · Local only on
 *   (the cloud AIs' rings go to a dashed rule, and their headers give way to a plain status line, "Off while Local
 *   only is on", over their brackets: words, never a sticker, which is never state; Taalcut's own models' ring
 *   glows) · the track: fits on a wide screen, scrolls sideways with snap on a narrow one, inside itself (the page
 *   never does), fading at the edge while there is more · arrow keys, Home and End move between the avatars.
 * motion: the avatar's lift; the status line fades in (150 ms under reduced motion).
 * Every AI Taalcut works with as a stories tray: a round avatar each, its ring the way in (violet: a cloud AI, the
 * AI's; teal: Taalcut's own models, yours; ink: your own server), its name in words under it, and the ways labelled
 * across the top the way a segment bar labels its parts, each over a bracket. A tap opens that AI's story. */

import { CloudOff, KeyRound, Laptop, LogIn, type LucideIcon, Server } from 'lucide-react';
import { motion } from 'motion/react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { BrandMark } from '#components/brand/brand-mark';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { ICON_TONES, type IconTone } from '#components/ui/icon-text';
import { type AiStory, STORIES, STORY_WAYS, WAY_HEADERS } from '#content/ai-stories';
import type { ProviderWay } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { DUR, REDUCED_FADE } from '#lib/motion';
import { StoryAvatar } from './story-avatar';

const WAY_LOOK: Readonly<Record<ProviderWay, { readonly icon: LucideIcon; readonly tone: IconTone }>> = {
  subscription: { icon: LogIn, tone: 'ai' },
  'api-key': { icon: KeyRound, tone: 'ai' },
  'own-server': { icon: Server, tone: 'muted' },
  'on-device': { icon: Laptop, tone: 'you' },
};

const CLOUD: ReadonlySet<ProviderWay> = new Set(['subscription', 'api-key']);

export interface StoryTrayProps {
  readonly stories: readonly AiStory[];
  readonly open: string;
  readonly onOpen: (id: string) => void;
  /** The stage the avatars open stories in. */
  readonly controls: string;
  /** Local only on: the cloud AIs paused, Taalcut's own models glowing. */
  readonly localOnly?: boolean;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

interface ItemProps {
  readonly story: AiStory;
  readonly open: boolean;
  readonly paused: boolean;
  readonly glowing: boolean;
  readonly size: 'sm' | 'md';
  readonly controls: string;
  readonly onOpen: () => void;
}

function Item({ story, open, paused, glowing, size, controls, onOpen }: ItemProps) {
  const own = story.provider.way === 'on-device';
  return (
    <li className="flex snap-start">
      <button
        type="button"
        data-story-tab={story.id}
        aria-pressed={open}
        aria-controls={controls}
        onClick={onOpen}
        className={cn(
          'group relative flex w-max flex-col items-center gap-1.5 rounded-xl pt-1 pb-2 transition-[scale] duration-(--dur-micro) ease-(--ease-out) active:scale-97 motion-reduce:active:scale-100',
          size === 'md' ? 'min-w-[4.5rem] px-1' : 'min-w-15 px-0.5',
        )}
      >
        <StoryAvatar
          provider={story.provider}
          ring={story.ring}
          size={size}
          paused={paused}
          glowing={glowing}
          className={cn(
            'transition-[scale,border-color,box-shadow] duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
            open ? 'scale-108' : 'pointer-fine:group-hover:scale-104',
          )}
        />
        {own ? (
          <span className={cn('whitespace-nowrap', size === 'md' ? 'type-label-sm' : 'type-meta', open ? 'font-semibold text-ink' : 'text-ink-2')}>
            {story.provider.name}
          </span>
        ) : (
          <BrandMark name={story.provider.name} className={cn(size === 'md' ? 'type-label-sm' : 'type-meta', open ? 'font-semibold text-ink' : 'text-ink-2')} />
        )}
        <span aria-hidden className={cn('absolute bottom-0 left-1/2 h-1 w-4 -translate-x-1/2 rounded-pill transition-colors duration-(--dur-short)', open ? 'bg-ink' : 'bg-transparent')} />
      </button>
    </li>
  );
}

function Group({ way, children, paused, size }: { readonly way: ProviderWay; readonly children: ReactNode; readonly paused: boolean; readonly size: 'sm' | 'md' }) {
  const id = useId();
  const look = WAY_LOOK[way];
  const Icon = look.icon;
  return (
    <div role="group" aria-labelledby={id} data-way={way} className={cn('flex shrink-0 flex-col', size === 'md' ? 'gap-2' : 'gap-1.5')}>
      <p id={id} className={cn('m-0 inline-flex items-center gap-1.5 ps-1 font-semibold whitespace-nowrap text-ink-2', size === 'md' ? 'type-label-sm' : 'type-meta', paused && 'invisible')}>
        <Icon aria-hidden strokeWidth={ICON_STROKE} className={cn('size-3.5 shrink-0', paused ? 'text-ink-3' : ICON_TONES[look.tone])} />
        {WAY_HEADERS[way]}
      </p>
      <span aria-hidden className="h-1.5 w-full rounded-t-sm border-x border-t border-rule-strong" />
      {children}
    </div>
  );
}

export function StoryTray({ stories, open, onOpen, controls, localOnly = false, size = 'md', className }: StoryTrayProps) {
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const [more, setMore] = useState(false);
  const first = useRef(true);

  // While there is more to the right, the track fades at its edge.
  useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // A story opened from elsewhere (Local only, Previous and Next) brings its avatar into the track's view, sideways only.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = track.current;
    const item = el?.querySelector<HTMLElement>(`[data-story-tab="${open}"]`);
    if (!el || !item) return;
    const a = el.getBoundingClientRect();
    const b = item.getBoundingClientRect();
    if (b.left >= a.left && b.right <= a.right) return;
    el.scrollTo({ left: el.scrollLeft + (b.left - a.left) - (a.width - b.width) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [open, reduce]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const tabs = [...(track.current?.querySelectorAll<HTMLButtonElement>('[data-story-tab]') ?? [])];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : Math.min(tabs.length - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)));
    tabs[next]?.focus();
  };

  const item = (s: AiStory) => (
    <Item
      key={s.id}
      story={s}
      open={s.id === open}
      paused={localOnly && CLOUD.has(s.provider.way)}
      glowing={localOnly && s.provider.way === 'on-device'}
      size={size}
      controls={controls}
      onOpen={() => onOpen(s.id)}
    />
  );
  const group = (way: ProviderWay) => (
    <Group key={way} way={way} size={size} paused={localOnly && CLOUD.has(way)}>
      <ul id={`stories-${way}`} className="m-0 flex list-none gap-0.5 p-0">
        {stories.filter((s) => s.provider.way === way).map(item)}
      </ul>
    </Group>
  );
  const cloud = STORY_WAYS.filter((w) => CLOUD.has(w));
  const rest = STORY_WAYS.filter((w) => !CLOUD.has(w));

  return (
    <div
      ref={track}
      onKeyDown={onKeyDown}
      data-slot="story-tray"
      data-more={more || undefined}
      className={cn(
        '-mx-gutter overflow-x-auto overscroll-x-contain px-gutter py-1.5 [scrollbar-width:none] snap-x snap-mandatory scroll-px-gutter [&::-webkit-scrollbar]:hidden',
        more && '[mask-image:linear-gradient(to_right,var(--color-ink)_calc(100%-3rem),transparent)]',
        className,
      )}
    >
      <div className={cn('flex w-max items-start', size === 'md' ? 'gap-5 sm:gap-6' : 'gap-3')}>
        <div className={cn('relative flex items-start', size === 'md' ? 'gap-5 sm:gap-6' : 'gap-3')}>
          {cloud.map(group)}
          {localOnly ? (
            // A status, not a sticker: plain words on the cloud groups' header row, in place of their headers.
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduce ? REDUCED_FADE : DUR.short }}
              data-slot="paused-label"
              className={cn(
                'pointer-events-none absolute top-0 left-0 inline-flex items-center gap-1.5 ps-1 type-label whitespace-nowrap text-ink-2',
                size === 'md' ? 'h-5' : 'h-4',
              )}
            >
              <CloudOff aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0" />
              {STORIES.paused}
            </motion.span>
          ) : null}
        </div>
        {rest.map(group)}
      </div>
    </div>
  );
}
