// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a video per feature · mode: Operate · system: WEB2 Remix Vernacular
 * Products › Taalcut in the coded app window, led by the videos it makes: the product with its sources (taalcut.app,
 *   the site's project folder, its Instagram page) in one line; its video ideas as a row of 9:16 reels from the
 *   owner's footage, each about one of Taalcut's features with the line from taalcut.app behind it as a sticker;
 *   the idea you choose made into your video, playing, its post waiting for your approval beside it; and the
 *   research schedule and limits as one quiet strip under it all
 * states: the arrival (once, when scrolled to: research runs, the idea reels arrive, the first becomes your video,
 *   its post waits; said once to screen readers) · finished (the server HTML, already on screen at load, reduced
 *   motion: the reels, the first chosen, its video playing on Play, the post awaiting approval) · Find video ideas
 *   again (research, then other features: no topic comes back before its days are up) · a reel chosen (its video
 *   is made, then its post waits again) · the post approved (queued, then scheduled) · the schedule switched off or
 *   its days changed. The parts carry their own states
 * motion: the arrival is the page's one orchestrated moment; reduced motion: everything finished, the visitor's
 *   actions land at once */

import { Folder, Globe, Quote } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { Logo } from '#components/brand/logo';
import { AppWindow } from '#components/ui/app-window';
import { Sticker } from '#components/ui/sticker';
import { Chip } from '../chip';
import { ShowcasePlate } from '../plate';
import { prefersReducedMotion, useArrival } from '../use-arrival';
import { IdeaReels } from './idea-reels';
import {
  batchOf,
  type Idea,
  MAKING_MS,
  PRODUCT,
  PRODUCT_PASS,
  PRODUCT_SOURCES,
  productPassAt,
  productPassTimes,
  type PostStatus,
  QUEUED_MS,
  RESEARCH_MS,
  SCHEDULE,
  toggleDay,
} from './ideas';
import { LOOK } from './meta';
import { ScheduleStrip } from './schedule-strip';
import { YourVideo } from './your-video';

/** Timers that a new run, or the component leaving, clears. */
function useTimers() {
  const timers = useRef<number[]>([]);
  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => stop, [stop]);
  return useMemo(() => ({ after, stop }), [after, stop]);
}

export function SourcesRow() {
  return (
    <ul aria-label="Sources" className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
      {PRODUCT_SOURCES.map((s) => (
        <li key={s.id}>
          <Chip>
            {s.kind === 'social' ? <BrandIcon id="instagram" /> : s.kind === 'folder' ? <Folder aria-hidden /> : <Globe aria-hidden />}
            <span className="sr-only">{s.label}: </span>
            {s.name}
          </Chip>
        </li>
      ))}
    </ul>
  );
}

export function ProductShowcase() {
  const [box, phase] = useArrival<HTMLDivElement>(0.3, 0.6);
  const pass = useTimers();
  const work = useTimers();
  const post = useTimers();
  const [ms, setMs] = useState<number>(PRODUCT_PASS.end);
  const [playing, setPlaying] = useState(false);
  const [round, setRound] = useState(0);
  const [researching, setResearching] = useState(false);
  const [arrived, setArrived] = useState(3);
  const [made, setMade] = useState<Idea>(batchOf(0)[0]!);
  const [video, setVideo] = useState<'none' | 'making' | 'ready'>('ready');
  const [status, setStatus] = useState<PostStatus>('waiting');
  const [on, setOn] = useState(true);
  const [days, setDays] = useState<readonly number[]>(SCHEDULE.days);

  const batch = batchOf(round);
  const frame = productPassAt(ms);
  // The arrival chooses the first reel once the ideas are in; before that, none is yours yet.
  const shown = playing
    ? { researching: frame.researching, arrived: frame.ideas, chosen: frame.open ? made.id : '', video: frame.video, post: frame.post }
    : { researching, arrived, chosen: made.id, video, post: true };

  useEffect(() => {
    if (phase === 'waiting') {
      setMs(-1);
      setPlaying(true);
    } else if (phase === 'play') {
      setMs(0);
      setPlaying(true);
      for (const at of productPassTimes()) pass.after(at, () => setMs(at));
      pass.after(PRODUCT_PASS.end, () => setPlaying(false));
    }
  }, [phase, pass]);

  /** A visitor's press ends the arrival where it would have ended. */
  const settle = () => {
    if (!playing) return;
    pass.stop();
    setPlaying(false);
    setMs(PRODUCT_PASS.end);
  };
  const make = (idea: Idea) => {
    settle();
    post.stop();
    setMade(idea);
    setStatus('waiting');
    if (prefersReducedMotion()) {
      setVideo('ready');
      return;
    }
    setVideo('making');
    post.after(MAKING_MS, () => setVideo('ready'));
  };
  const find = () => {
    settle();
    work.stop();
    const next = round + 1;
    setRound(next);
    const first = batchOf(next)[0]!;
    if (prefersReducedMotion()) {
      setArrived(3);
      make(first);
      return;
    }
    setResearching(true);
    setArrived(0);
    work.after(RESEARCH_MS, () => setResearching(false));
    [1, 2, 3].forEach((n) => work.after(RESEARCH_MS + n * 160, () => setArrived(n)));
    work.after(RESEARCH_MS + 3 * 160, () => make(first));
  };
  const approve = () => {
    settle();
    post.stop();
    setStatus('queued');
    post.after(prefersReducedMotion() ? 0 : QUEUED_MS, () => setStatus('scheduled'));
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative">
        <AppWindow title="Products" area={LOOK.area} size="lg" fit="fluid">
          <ShowcasePlate slug="product-videos" label="Products: Taalcut, its video ideas as reels, and your video waiting to be posted" className="flex flex-col gap-5">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule-subtle pb-4">
              <Logo kind="symbol" className="size-7" />
              <h3 className="m-0 type-page-title text-ink">{PRODUCT.name}</h3>
              <Chip tone="you">{PRODUCT.mode}</Chip>
              <span className="flex min-w-0 flex-wrap items-center gap-2 @min-[48rem]:ms-auto">
                <span className="type-meta text-ink-2">Sources: {PRODUCT_SOURCES.length}</span>
                <SourcesRow />
              </span>
            </header>
            <div ref={box} data-pass={playing ? 'playing' : 'finished'} className="grid min-w-0 grid-cols-1 gap-8 @min-[56rem]:grid-cols-[minmax(0,1fr)_19rem]">
              <IdeaReels
                ideas={batch}
                arrived={shown.arrived}
                researching={shown.researching}
                chosen={shown.chosen}
                making={shown.video === 'making'}
                onChoose={(idea) => (idea.id === made.id && !playing ? undefined : make(idea))}
                onFind={find}
              />
              <YourVideo idea={made} video={shown.video} post={shown.post} status={status} onApprove={approve} />
            </div>
            <ScheduleStrip on={on} onSwitch={setOn} days={days} onDay={(d) => setDays((all) => toggleDay(all, d))} />
          </ShowcasePlate>
        </AppWindow>
        <span className="absolute -top-4 right-6 z-10">
          <Sticker field="sky" icon={Quote} tilt={3}>
            Lines from taalcut.app
          </Sticker>
        </span>
      </div>
    </MotionConfig>
  );
}
