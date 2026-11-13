// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Shorts from long videos, its showcase, its index fragment and its fact rows' scenes · mode: Operate ·
 *   system: WEB2 Remix Vernacular (violet is the AI's pick)
 * the coded app window open on a long video in the library (the owner's clips end to end as one trip, the creator's
 *   narration under them), with Make a short open on it, as the app's dialog: choose a length and Create short, and
 *   the AI marks the hook, the context and the payoff as whole sentences over whole scenes, they gather into a 9:16
 *   short that plays with its captions word by word, and the second check passes with its tick. The index's fragment
 *   is the long video and its length: change it and the AI marks another short
 * states: the parts' own (long-video, make-dialog, short-preview); Make a short (secondary button: default, hover,
 *   focus, active; aria-expanded with the dialog, which Cancel closes and it opens again)
 * motion: making a short is the one arrival: it plays once when scrolled to (marks, gather, check, under four
 *   seconds), then the short plays once; reduced motion: the made short, still, until Play */

import { Film, ListChecks, Scissors, TextQuote, Timer, type LucideIcon } from 'lucide-react';
import { type ComponentType, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { Chip } from '../chip';
import { ShowcasePlate } from '../plate';
import { Segmented } from '../segmented';
import type { Scene } from '../vignette';
import { LongVideo } from './long-video';
import { MakeDialog } from './make-dialog';
import { LOOK } from './meta';
import { CheckScene, LengthScene, PicksScene, SourcesScene } from './scenes';
import { useShortRun } from './short-run';
import { ShortPreview } from './short-preview';
import { clock, DEFAULT_LENGTH, LENGTHS, lengthWords, LONG_SECONDS, LONG_VIDEO, SCENES } from './trip';

/** The feature page's showcase: a long video, Make a short, and the short it makes. */
export function ShortsShowcase() {
  const run = useShortRun();
  const reduce = useReducedMotionPref();
  const [open, setOpen] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <AppWindow title={LONG_VIDEO} area={LOOK.area} size="lg" fit="fluid">
      <ShowcasePlate slug="shorts" label="Make a short from a long video" className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule-subtle pb-4">
          <h3 className="m-0 me-auto type-page-title text-ink">{LONG_VIDEO}</h3>
          <Chip>
            <Film aria-hidden />
            {clock(LONG_SECONDS)}
          </Chip>
          <Chip>{SCENES.length} scenes</Chip>
          <button
            ref={opener}
            type="button"
            aria-expanded={open}
            className={buttonClasses('secondary', 'md')}
            onClick={() => setOpen(true)}
          >
            <Scissors aria-hidden className="size-4" />
            Make a short
          </button>
        </header>
        <div ref={run.box} data-run={run.phase}>
          <LongVideo picks={run.picks} marked={run.marked} reduce={reduce} />
        </div>
        <div className={cn('grid grid-cols-1 items-start gap-8', open && '@min-[60rem]:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]')}>
          {open ? (
            <MakeDialog
              onCreate={run.create}
              onCancel={() => {
                setOpen(false);
                opener.current?.focus();
              }}
            />
          ) : null}
          <ShortPreview run={run} />
        </div>
      </ShowcasePlate>
    </AppWindow>
  );
}

const OPTIONS = LENGTHS.map((n) => ({ value: String(n), label: lengthWords(n) }));

/** The features index's live fragment: the long video, its length, and the short the AI marks on it. */
export function ShortsFragment() {
  const run = useShortRun();
  const reduce = useReducedMotionPref();
  const [choice, setChoice] = useState(String(DEFAULT_LENGTH));
  const context = run.picks.filter((p) => p.role === 'context').length;
  return (
    <AppWindow title={LONG_VIDEO} area={LOOK.area} size="md" fit="fluid">
      <ShowcasePlate slug="shorts-fragment" label="A long video, made short" className="flex flex-col gap-4">
        <div ref={run.box} data-run={run.phase}>
          <LongVideo picks={run.picks} marked={run.marked} reduce={reduce} compact />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule-subtle pt-4">
          <span className="type-label text-ink">Target length</span>
          <Segmented
            label="Target length"
            value={choice}
            onChange={(value) => {
              setChoice(value);
              run.create(Number(value));
            }}
            options={OPTIONS}
          />
        </div>
        <p role="status" className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 type-body text-ink-2">
          <span>
            <span className="tc-mono text-ink">{clock(run.seconds)}</span>: the hook, {context}{' '}
            {context === 1 ? 'sentence' : 'sentences'} of context and the payoff.
          </span>
          {run.check === 'passed' ? (
            <Chip tone="success">
              <ListChecks aria-hidden />
              Checked against the original frames
            </Chip>
          ) : null}
        </p>
      </ShowcasePlate>
    </AppWindow>
  );
}

/** Each fact's icon and scene, in the order of the feature's facts (#content/features-more). */
export const SHORTS_ROWS: readonly { readonly icon: LucideIcon; readonly Scene: ComponentType<Scene> }[] = [
  { icon: Film, Scene: SourcesScene },
  { icon: Timer, Scene: LengthScene },
  { icon: TextQuote, Scene: PicksScene },
  { icon: ListChecks, Scene: CheckScene },
];
