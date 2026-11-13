// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: plugins and other agents at work on a video · mode: Operate · system: WEB2 Remix Vernacular (the ink
 *   pill is a card's go-ahead, the page's marigold kept for its download; teal is what you allowed)
 * what a plugin does for a video, before any setting: Claude Code's ask arriving as a message that carries the
 *   reel's poster (the app's approval card: who is asking, Can Taalcut go ahead?, the export, the level you gave it
 *   as Read · Edit · Export, Go ahead and Not now); the sound the cut is on, trending in Instagram Edits, its row
 *   drawn as its waveform with the hook drop marked; and the Vietnam cut as a Postiz post, a 9:16 preview playing
 *   with its channel and words on it, its time under it, waiting for your approval.
 * states: the ask: waiting for it (while the arrival connects the agent) · waiting for you · approved · declined ·
 *   none (after Revoke) · its level: Read, Edit or Export lit up to what you gave · the post: waiting for your
 *   approval · scheduled (its line, announced) · buttons: default, hover, focus, active · the reel's own (ReelFrame)
 * motion: the ask rises 8 px and pops in as it arrives; its level steps light in turn; reduced motion: at once */

import { CalendarClock, Check, CircleCheck, Clock, Hourglass } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { buttonClasses } from '#components/ui/button-classes';
import { ReelFrame } from '#components/ui/reel-frame';
import { reelById } from '#content/reels';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { PosterFrame } from '../frame';
import { hookLabel, hooksOf, soundById } from '../instagram-edits/sounds';
import { RowWave } from '../instagram-edits/waveform';
import { INK_PILL } from '../product-videos/ink';
import { AGENT_APPS, ASK, LEVEL_STEPS, POSTIZ_POST } from './plugins-data';
import type { Agents } from './use-agents';

const REEL = reelById('vietnam');

/** What the agent may do, as three steps lit up to the level you gave it. */
function LevelSteps({ level, agent }: { readonly level: number; readonly agent: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="type-caption text-ink-2">What {agent} may do</span>
      <span aria-hidden className="inline-flex items-center gap-0.5 rounded-pill bg-sunken p-0.5">
        {LEVEL_STEPS.map((step, i) => (
          <span
            key={step}
            data-level-step={i < level ? 'on' : 'off'}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-pill px-2.5 type-caption font-semibold transition-colors duration-(--dur-short) ease-(--ease-out)',
              i < level ? 'bg-teal-soft text-teal-strong' : 'text-ink-3',
            )}
          >
            {i < level ? <Check strokeWidth={3} className="size-3" /> : null}
            {step}
          </span>
        ))}
      </span>
      <span className="sr-only">{LEVEL_STEPS.slice(0, level).join(', ')}</span>
    </div>
  );
}

/** Claude Code's ask, on the app's approval card, with the reel's poster. */
export function AskCard({ agents, compact = false }: { readonly agents: Agents; readonly compact?: boolean }) {
  const request = agents.request;
  const session = agents.sessions.find((s) => s.id === request?.session);
  if (!request || !session) {
    return (
      <p data-slot="approval-waiting" className="m-0 flex items-center gap-2 rounded-xl border border-dashed border-rule-strong px-4 py-5 type-body text-ink-2">
        <Clock aria-hidden className="size-4 shrink-0" />
        {agents.running ? 'Waiting for Claude Code to connect…' : 'Nothing is waiting for you from other agents.'}
      </p>
    );
  }
  const app = AGENT_APPS.find((a) => a.id === session.app) ?? AGENT_APPS[0]!;
  const level = session.level === 'export' ? 3 : session.level === 'edit' ? 2 : 1;
  const status = request.status;
  return (
    <motion.article
      data-slot="approval"
      data-status={status}
      className="flex flex-col gap-3.5 rounded-xl border border-rule-subtle bg-raised p-4 shadow-sticker"
      initial={agents.grown && !agents.reduce ? { opacity: 0, y: 8, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: agents.reduce ? 0.15 : 0.35, ease: EASE_OUT }}
    >
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-meta text-ink-2">
        <span data-slot="icon-text" className="inline-flex items-center gap-1.5">
          <BrandIcon id={app.brand} className="size-4" />
          <span>
            <span translate="no" className="font-semibold text-ink">
              {app.name}
            </span>{' '}
            (an external agent) is asking
          </span>
        </span>
        <Chip tone={status === 'waiting' ? 'warning' : status === 'approved' ? 'success' : 'neutral'}>
          {status === 'waiting' ? 'Waiting for you' : status === 'approved' ? 'Approved' : 'Declined'}
        </Chip>
      </p>
      <div className="flex items-start gap-3.5">
        <PosterFrame src={REEL.poster} className={cn('shrink-0 rounded-lg shadow-sticker', compact ? 'w-12' : 'w-16')} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 type-label text-ink-2">Can Taalcut go ahead?</p>
          <p className={cn('m-0 text-balance text-ink', compact ? 'type-card-title' : 'type-page-title')}>{ASK.summary}</p>
          <p className="m-0 type-meta text-ink-2">{ASK.detail}</p>
        </div>
      </div>
      <LevelSteps level={level} agent={app.name} />
      {status === 'waiting' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => agents.answer('approved')} className={INK_PILL}>
            Go ahead
          </button>
          <button type="button" onClick={() => agents.answer('declined')} className={buttonClasses('secondary', 'md')}>
            Not now
          </button>
        </div>
      ) : (
        <p role="status" className="m-0 flex items-center gap-2 type-body text-ink">
          {status === 'approved' ? <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" /> : null}
          {status === 'approved' ? ASK.approved : ASK.declined}
        </p>
      )}
    </motion.article>
  );
}

/** The sound the cut is on, from Instagram Edits: its waveform, its hook drop. */
export function EditsSound() {
  const sound = soundById('night-market');
  const hook = hooksOf(sound)[0] ?? 0;
  return (
    <section aria-label="The sound, from Instagram Edits" className="flex flex-col gap-2 rounded-xl border border-rule-subtle bg-raised p-4">
      <p className="m-0 flex flex-wrap items-center justify-between gap-2 type-meta text-ink-2">
        <span data-slot="icon-text" className="inline-flex items-center gap-1.5">
          <BrandIcon id="instagram" className="size-4" />
          Instagram Edits · trending sound
        </span>
        <span className="tabular-nums">
          {sound.artist} · {Math.round(sound.durationSec)} s
        </span>
      </p>
      <p className="m-0 type-card-title text-ink">{sound.title}</p>
      <RowWave sound={sound} at={null} bars={84} />
      <p className="m-0 type-meta text-ink-2">
        The cut lands on its beats, the hook drop at <span className="tc-mono text-rose-strong">{hookLabel(hook)}</span>.
      </p>
    </section>
  );
}

/** The Vietnam cut as a Postiz post: the reel playing with its channel and words on it, its time, your approval. */
export function PostCard() {
  const [status, setStatus] = useState<'waiting' | 'scheduled'>('waiting');
  return (
    <section aria-label="A post in Postiz" data-post={status} className="order-first flex min-w-0 flex-col gap-4 @min-[52rem]:order-none">
      <div className="mx-auto w-full max-w-[15rem]">
        <ReelFrame sources={REEL.reference} poster={REEL.poster} label={`The video to post: ${REEL.title}`}>
          <span className="absolute top-3 left-3 inline-flex max-w-[calc(100%-4rem)] items-center gap-1.5 rounded-pill bg-viewer/70 px-2.5 py-1 type-caption font-semibold text-viewer-ink">
            <BrandIcon id="instagram" className="size-3.5 shrink-0" />
            <span className="truncate">{POSTIZ_POST.channel}</span>
          </span>
          <span className="absolute inset-x-4 bottom-5 flex flex-col gap-1 text-viewer-ink">
            <span className="type-label font-semibold">{POSTIZ_POST.account}</span>
            <span className="line-clamp-3 type-meta text-pretty">{POSTIZ_POST.words}</span>
          </span>
        </ReelFrame>
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-label text-ink">
          Postiz
          <span role="status" className={cn('inline-flex items-center gap-1 type-label-sm', status === 'waiting' ? 'text-ink-2' : 'text-success-strong')}>
            {status === 'waiting' ? <Hourglass aria-hidden className="size-3.5" /> : <CircleCheck aria-hidden className="size-3.5" />}
            {status === 'waiting' ? 'Waiting for your approval' : 'Scheduled'}
          </span>
        </p>
        <p className="m-0 flex items-center gap-1.5 type-meta text-ink tabular-nums">
          <CalendarClock aria-hidden className="size-3.5 shrink-0 text-ink-2" />
          {POSTIZ_POST.when}
        </p>
        {status === 'waiting' ? (
          <button type="button" onClick={() => setStatus('scheduled')} className={cn(INK_PILL, 'w-full')}>
            <Check aria-hidden className="size-4" />
            Approve and schedule
          </button>
        ) : (
          <p className="m-0 type-meta text-pretty text-ink-2">{POSTIZ_POST.scheduled}</p>
        )}
      </div>
    </section>
  );
}
