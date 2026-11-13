// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the editor you talk to, tied to the reel · mode: Operate · system: WEB2 Remix Vernacular (Motion: Arrival
 *   is the run's one entrance; text being read never types itself out)
 * the reel you pasted plays beside the coded app window, open on Agent (agent-reel.tsx). In the chat: your message
 *   with the reel, the agent's one line of plan, its run (four steps) and the run's picture, your cut under the reel's
 *   slots (check-strip.tsx), each check ticking onto the slots there and on the reel's own bar beside; the agent's
 *   words; what it changed as clips before and after, with Undo; the one approval, which turns the reel to Your
 *   version; and the chat box, where how hard it thinks is chosen
 * states: finished (the server's HTML and reduced motion: every slot checked, the approval waiting) · waiting to be
 *   scrolled to (the slots empty, their numbers showing) · running (clips landing on the beat, the cuts marked, the
 *   shots checked one by one, a miss swapped; said once to screen readers) · finished again · Replay: default,
 *   hover, focus, active · the cards' and the reel's own
 * motion: the run is the page's one orchestrated arrival, under five seconds; reduced motion: no run until asked,
 *   and then the finished state at once */

import { MotionConfig } from 'motion/react';
import { useState } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { SHOWCASE_ICONS } from '../icons';
import { ShowcasePlate } from '../plate';
import { StageGrid } from '../stage';
import { prefersReducedMotion } from '../use-arrival';
import { ApprovalCard, ChangesCard } from './agent-cards';
import { AgentReel, type View } from './agent-reel';
import { AgentMessage, RunBlock, UserMessage } from './chat-parts';
import { CheckStrip } from './check-strip';
import { Composer } from './composer';
import {
  ATTACHMENT,
  CHANGES,
  INTRO_WORDS,
  missedWith,
  OUTRO_WORDS,
  USER_WORDS,
  WORKING_WORDS,
} from './run-script';
import { type AgentRun, useAgentRun } from './use-agent-run';

export function AgentChat({
  run,
  compact = false,
  onView,
}: {
  readonly run: AgentRun;
  readonly compact?: boolean;
  readonly onView?: (view: View) => void;
}) {
  const { frame } = run;
  const live = run.status === 'playing';
  const Replay = SHOWCASE_ICONS.replay;
  /** Any change to the timeline asks for a fresh look: the review closes, the reel shows the saved reel again. */
  const changed = (undone: number) => {
    run.setUndone(undone);
    run.setReview('waiting');
    onView?.('saved');
  };
  const replay = () => {
    onView?.('saved');
    if (prefersReducedMotion()) {
      run.setUndone(0);
      run.setReview('waiting');
      return;
    }
    run.replay();
  };
  return (
    <MotionConfig reducedMotion="user">
      <ShowcasePlate
        slug={compact ? 'agent-fragment' : 'agent'}
        label="A chat with Taalcut’s agent, checked against the reel"
        className="flex flex-col gap-5"
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule-subtle pb-4">
          <h3 className="m-0 me-auto type-card-title text-ink">
            {compact ? 'The agent at work' : 'Vietnam reel'}
          </h3>
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={replay}>
            <Replay aria-hidden className="size-4" />
            {compact ? 'Play the run' : 'Replay'}
          </button>
          <span role="status" className="sr-only">
            {run.status === 'playing'
              ? 'Making the reel and checking it against the reel you pasted.'
              : run.status === 'finished' && frame.done
                ? 'The cut is checked.'
                : ''}
          </span>
        </header>
        <div ref={run.box} data-replay={run.status} className="flex min-w-0 flex-col gap-4">
          <UserMessage text={USER_WORDS} attachment={ATTACHMENT} />
          {compact ? null : <AgentMessage text={INTRO_WORDS} />}
          <RunBlock steps={frame.steps}>
            <CheckStrip frame={frame} undone={run.undone} live={live} />
          </RunBlock>
          {compact ? null : (
            <>
              <AgentMessage text={frame.done ? OUTRO_WORDS : WORKING_WORDS} working={!frame.done} />
              <div className="@container">
                <div className="grid grid-cols-1 gap-4 @min-[40rem]:grid-cols-2">
                  <ChangesCard
                    undone={run.undone}
                    happened={(c) => (c.swap ? (frame.swapped[c.swap.slot] ?? true) : frame.done)}
                    onUndo={() => changed(Math.min(CHANGES.length, run.undone + 1))}
                    onRedo={() => changed(Math.max(0, run.undone - 1))}
                  />
                  <ApprovalCard
                    checks={frame.checks}
                    missed={frame.done ? missedWith(run.undone) : []}
                    done={frame.done}
                    review={run.review}
                    onReview={() => {
                      run.setReview('reviewing');
                      // A frame later, so the reel's version layer is in place to fade in.
                      window.requestAnimationFrame(() => onView?.('yours'));
                    }}
                    onExport={() => run.setReview('exported')}
                    onNotNow={() => {
                      run.setReview('waiting');
                      onView?.('saved');
                    }}
                  />
                </div>
              </div>
              <Composer think={run.think} onThink={run.setThink} />
            </>
          )}
        </div>
      </ShowcasePlate>
    </MotionConfig>
  );
}

/** The feature page's stage: the reel the chat follows, playing, beside the app window open on Agent. */
export function AgentStage() {
  const run = useAgentRun(true);
  const [view, setView] = useState<View>('saved');
  return (
    <StageGrid reel={<AgentReel run={run} view={view} onView={setView} />}>
      <AppWindow title="Agent" area="agent" size="lg" fit="fluid">
        <AgentChat run={run} onView={setView} />
      </AppWindow>
    </StageGrid>
  );
}
