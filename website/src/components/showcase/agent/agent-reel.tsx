// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the reel the agent follows · mode: Persuade (footage first) · system: WEB2 Remix Vernacular
 * the Vietnam reel you pasted, playing in the world's 28 px frame beside the chat: its slots as the segment bar on top
 *   (rose music beats), and under each slot the agent's tick as the check passes it, so the check lands on the reel
 *   itself; the Saved reel / Your version tabs at its foot, and the facts as stickers on its edge. Review and export
 *   in the chat turns it to Your version: the cut's own clips on the reel's clock, under the same bar
 * states: the reel frame's own (poster, playing on screen, paused by the visitor, reduced motion never starting by
 *   itself) · a slot's tick: waiting (none) · checked (the violet tick pops on) · missed (a dashed violet ring) ·
 *   the view: Saved reel · Your version (once reviewed; before that its tab is locked) · the tabs: default, hover,
 *   focus, pressed (the shown view, underlined) · Your version's sticker pops on as it first shows
 * motion: a tick pops on (transform, opacity) during a run; Your version crossfades in (the version layer's own);
 *   reduced motion: the 150 ms fade */

import { AudioLines, Link, Lock } from 'lucide-react';
import { motion, useMotionValue } from 'motion/react';
import { useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { VersionLayer } from '#components/demo/version-layer';
import { ReelFrame } from '#components/ui/reel-frame';
import { SegmentBar } from '#components/ui/segment-bar';
import { Sticker } from '#components/ui/sticker';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { frameOf, spriteStyle } from '../frames';
import { SHOWCASE_ICONS } from '../icons';
import { OnEdge, reelSegments } from '../reel-side';
import { slotStates } from './check-strip';
import { clipsWith, REEL } from './run-script';
import type { AgentRun } from './use-agent-run';

export type View = 'saved' | 'yours';

const VIEW_WORDS: Readonly<Record<View, string>> = { saved: 'Saved reel', yours: 'Your version' };

function Ticks({ run }: { readonly run: AgentRun }) {
  const states = slotStates(run.frame, run.undone);
  const live = run.status === 'playing';
  return (
    <span aria-hidden className="mt-2 flex gap-1">
      {states.map((state, k) => (
        <span key={k} className="flex min-w-0 flex-1 justify-center">
          {state === 'checked' ? (
            <motion.span
              initial={live ? { opacity: 0, scale: 0.3 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 22 }}
              data-reel-tick="checked"
              className="inline-grid size-3.5 place-items-center rounded-pill bg-violet text-violet-ink shadow-sticker"
            >
              <SHOWCASE_ICONS.approve strokeWidth={3.5} className="size-2.5" />
            </motion.span>
          ) : state === 'missed' ? (
            <span
              data-reel-tick="missed"
              className="size-3.5 rounded-pill border-[1.5px] border-dashed border-viewer-ink bg-violet/60"
            />
          ) : (
            <span className="size-3.5" />
          )}
        </span>
      ))}
    </span>
  );
}

function ViewTabs({
  view,
  ready,
  onView,
}: {
  readonly view: View;
  readonly ready: boolean;
  readonly onView: (view: View) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Which version the reel shows"
      className="mx-auto flex w-fit gap-1 rounded-pill bg-viewer/55 px-1.5 py-0.5"
    >
      {(['saved', 'yours'] as const).map((v) => {
        const on = view === v;
        const locked = v === 'yours' && !ready;
        return (
          <button
            key={v}
            type="button"
            data-view={v}
            aria-pressed={on}
            aria-disabled={locked || undefined}
            onClick={() => {
              if (!locked) onView(v);
            }}
            className={cn(
              'relative inline-flex min-h-7 items-center gap-1 rounded-sm px-1.5 type-label-sm text-viewer-ink [text-shadow:0_1px_3px_var(--color-viewer)]',
              on ? 'font-bold' : 'font-medium',
              locked ? 'cursor-not-allowed' : !on && 'hover:opacity-80',
            )}
          >
            {locked ? <Lock aria-hidden strokeWidth={ICON_STROKE + 0.25} className="size-3.5" /> : null}
            {VIEW_WORDS[v]}
            {on ? (
              <span aria-hidden className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-pill bg-viewer-ink" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function AgentReel({
  run,
  view,
  onView,
}: {
  readonly run: AgentRun;
  readonly view: View;
  readonly onView: (view: View) => void;
}) {
  const time = useMotionValue(0);
  const reduce = useReducedMotionPref();
  const [playing, setPlaying] = useState(false);
  const ready = run.review !== 'waiting';
  const picks = clipsWith(run.frame, run.undone);
  const stills = picks.map((id) => spriteStyle(frameOf(id) ?? 0));
  const shown = view === 'yours' && ready;
  return (
    <ReelFrame
      sources={REEL.reference}
      poster={REEL.poster}
      label={
        shown
          ? `Your version of ${REEL.title}, made from your Vietnam clips`
          : `The reel you pasted: ${REEL.title}`
      }
      time={time}
      onPlayingChange={setPlaying}
      bar={
        <div>
          <SegmentBar segments={reelSegments(REEL)} beats={REEL.beats} time={time} state="playing" />
          <Ticks run={run} />
        </div>
      }
      bottom={<ViewTabs view={shown ? 'yours' : 'saved'} ready={ready} onView={onView} />}
      stickers={
        <>
          <OnEdge at="-right-6 top-[24%]">
            <Sticker field="sky" icon={Link} tilt={-4}>
              The reel you pasted
            </Sticker>
          </OnEdge>
          <OnEdge at="-left-5 top-[52%]">
            <Sticker field="pink" icon={AudioLines} tilt={3} delay={0.12}>
              {REEL.beats.length} music beats
            </Sticker>
          </OnEdge>
          {shown ? (
            <OnEdge at="-right-4 top-[70%]">
              <Sticker field="teal" icon={ICONS.make} tilt={-3}>
                Your version
              </Sticker>
            </OnEdge>
          ) : null}
        </>
      }
    >
      {/* Mounted once reviewed, so the server HTML holds no hidden layer; it fades in as the view turns. */}
      {ready ? (
        <VersionLayer
          reel={REEL}
          picks={picks}
          stills={stills}
          clock={time}
          shown={shown}
          playing={playing}
          load
          reduce={reduce}
        />
      ) : null}
    </ReelFrame>
  );
}
