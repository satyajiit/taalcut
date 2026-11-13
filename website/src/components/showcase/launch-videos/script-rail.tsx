// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the script and its one approval, as a rail · mode: Operate · system: WEB2 Remix Vernacular
 * Create's script in the app's words (create-scene.tsx, create-workspace.tsx), compact, under the video: its version
 *   and length, then each scene as a row (Scene N, which plays it in the video above; its words on screen in a field
 *   you can change; its length, half a second less or more). Any change makes a new version, and production waits
 *   for it: the ink Approve script & design is the one go-ahead, before anything is made
 * states: a scene: playing in the video (its row raised, aria-current) · not · the words field: default, hover, focus
 *   · the length buttons: default, hover, focus, active, disabled at 1 s and 12 s · the version: approved (teal: your
 *   go-ahead) · changed (a new version; the ink pill wakes; said once to screen readers) · Approve: default, hover,
 *   focus, active, pressed (a 2 % give as the arrival presses it), done (the control face, its words beside it)
 * motion: the pill gives as it is pressed; reduced motion: no give */

import { Check, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useId } from 'react';
import { cn } from '#lib/cn';
import { Chip } from '../chip';
import { RailHeading } from './brief-rail';
import { INK_PILL } from './ink';
import { SCENE_DOT } from './scene-frame';
import { type Scene, SECONDS_MAX, SECONDS_MIN, SECONDS_STEP, secondsLabel, totalSeconds } from './story';

const STEPPER =
  'inline-grid size-8 place-items-center rounded-pill border border-rule bg-control text-ink transition-colors duration-(--dur-micro) ' +
  'hover:bg-control-hover active:bg-control-pressed disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-control';

export function ScriptRail({
  scenes,
  playing,
  onPlay,
  onWords,
  onSeconds,
  version,
  approved,
  pressed,
  onApprove,
}: {
  readonly scenes: readonly Scene[];
  /** The scene the video is on. */
  readonly playing: number;
  readonly onPlay: (index: number) => void;
  readonly onWords: (index: number, words: string) => void;
  readonly onSeconds: (index: number, by: number) => void;
  readonly version: number;
  readonly approved: boolean;
  /** Bumped as the arrival presses Approve, so the pill gives. */
  readonly pressed: number;
  readonly onApprove: () => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-script`} className="@container flex min-w-0 flex-col gap-3">
      <RailHeading
        aside={
          <>
            <span role="status" className="inline-flex">
              <Chip tone={approved ? 'you' : 'neutral'}>
                Version {version}
                {approved ? ' · approved' : ' · not approved yet'}
              </Chip>
            </span>
            <Chip>
              {scenes.length} scenes · {secondsLabel(totalSeconds(scenes))}
            </Chip>
          </>
        }
      >
        <span id={`${id}-script`}>Script</span>
      </RailHeading>
      <ol aria-label="Scenes" className="m-0 flex list-none flex-col gap-0.5 p-0">
        {scenes.map((scene, i) => {
          const n = i + 1;
          const current = i === playing;
          return (
            <li
              key={scene.id}
              data-scene-row={scene.id}
              aria-current={current || undefined}
              className={cn(
                'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-lg px-1.5 py-1 transition-colors duration-(--dur-short)',
                '@min-[26rem]:grid-cols-[auto_minmax(0,1fr)_auto]',
                current ? 'bg-raised shadow-xs' : 'bg-transparent',
              )}
            >
              <button
                type="button"
                onClick={() => onPlay(i)}
                aria-label={`Scene ${n}`}
                className="col-start-1 row-start-1 inline-flex h-8 items-center gap-1.5 rounded-pill px-2 type-label-sm whitespace-nowrap text-ink-2 transition-colors duration-(--dur-micro) hover:bg-hover hover:text-ink"
              >
                <span aria-hidden className={cn('size-2.5 rounded-pill ring-1 ring-rule', SCENE_DOT[scene.look])} />
                <span aria-hidden className="tabular-nums">
                  {n}
                </span>
              </button>
              <input
                type="text"
                value={scene.words}
                maxLength={64}
                aria-label={`Scene ${n}, on-screen words`}
                onChange={(e) => onWords(i, e.target.value)}
                className="col-span-2 col-start-1 row-start-2 h-8 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 type-body text-ink hover:border-rule focus:border-rule-strong focus:bg-canvas @min-[26rem]:col-span-1 @min-[26rem]:col-start-2 @min-[26rem]:row-start-1"
              />
              <span role="group" aria-label={`Scene ${n}, length in seconds`} className="col-start-2 row-start-1 flex items-center gap-1 justify-self-end @min-[26rem]:col-start-3">
                <button
                  type="button"
                  className={STEPPER}
                  aria-label={`Scene ${n}, half a second shorter`}
                  disabled={scene.seconds <= SECONDS_MIN}
                  onClick={() => onSeconds(i, -SECONDS_STEP)}
                >
                  <Minus aria-hidden className="size-3.5" />
                </button>
                <span className="w-10 text-center type-label-sm text-ink tabular-nums">{secondsLabel(scene.seconds)}</span>
                <button
                  type="button"
                  className={STEPPER}
                  aria-label={`Scene ${n}, half a second longer`}
                  disabled={scene.seconds >= SECONDS_MAX}
                  onClick={() => onSeconds(i, SECONDS_STEP)}
                >
                  <Plus aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div data-slot="approval" data-status={approved ? 'approved' : 'waiting'} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-rule bg-raised p-3">
        <motion.button
          key={pressed}
          type="button"
          initial={pressed > 0 ? { scale: 0.96 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
          className={INK_PILL}
          disabled={approved}
          onClick={onApprove}
        >
          <Check aria-hidden className="size-4" />
          Approve script & design
        </motion.button>
        <p className="m-0 min-w-[14em] flex-1 type-body text-pretty text-ink">
          {approved ? (
            <>
              <Check aria-hidden strokeWidth={2.5} className="me-1.5 inline size-4 align-[-0.2em] text-teal-strong" />
              Approved. Production has the script and the look.
            </>
          ) : (
            'You approve the script and the look before anything is made.'
          )}
        </p>
      </div>
    </section>
  );
}
