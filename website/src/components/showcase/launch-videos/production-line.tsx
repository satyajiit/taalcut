// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: production, ticking under the video · mode: Operate · system: WEB2 Remix Vernacular
 * Create's production in the app's words (create-production.tsx, create-words.ts), on one line under the video: the
 *   director's tasks in turn (Research, Script, Design with the scene it is on, Voiceover, Review), each its mark;
 *   then where the video stands: waiting for the approval, becoming a video, or ready, with Open editor
 * states: a task: waiting (the hourglass, ink-3) · working (turning, violet: the AI) · complete (the AI's tick) ·
 *   the video: waiting for approval · being made · ready (Open editor: the secondary button's states)
 * motion: the working mark turns; reduced motion: it holds still */

import { ArrowUpRight, CircleCheck, Hourglass, LoaderCircle } from 'lucide-react';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import type { PassFrame } from './pass';
import { TASK_STATUS_WORDS, tasksFor, type TaskStatus, type Voice } from './story';

const MARK: Readonly<Record<TaskStatus, typeof CircleCheck>> = {
  queued: Hourglass,
  running: LoaderCircle,
  completed: CircleCheck,
};

export function ProductionLine({
  frame,
  approved,
  voice,
  scenes,
  onOpen,
}: {
  readonly frame: PassFrame;
  /** The current version of the script is approved. */
  readonly approved: boolean;
  readonly voice: Voice;
  readonly scenes: number;
  readonly onOpen: () => void;
}) {
  const ready = approved && frame.ready;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-rule-subtle pt-3">
      <ol aria-label="Production" className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0">
        {tasksFor(voice).map((task) => {
          const status: TaskStatus = approved ? frame.task[task.role] : task.role === 'researcher' || task.role === 'writer' ? 'completed' : 'queued';
          const Mark = MARK[status];
          const scene = task.role === 'designer' && status === 'running' && frame.designing !== null ? ` · scene ${frame.designing + 1} of ${scenes}` : '';
          return (
            <li key={task.role} data-task={task.role} data-status={status} className="flex items-center gap-1.5 type-label-sm whitespace-nowrap">
              <Mark
                aria-hidden
                strokeWidth={2.25}
                className={cn(
                  'size-4 shrink-0',
                  status === 'running' && 'animate-spin text-violet-strong motion-reduce:animate-none',
                  status === 'completed' && 'text-violet-strong',
                  status === 'queued' && 'text-ink-3',
                )}
              />
              <span className={status === 'queued' ? 'text-ink-2' : 'text-ink'}>
                {task.label}
                <span className="text-ink-2">{scene}</span>
              </span>
              <span className="sr-only">: {TASK_STATUS_WORDS[status]}</span>
            </li>
          );
        })}
      </ol>
      {ready ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 type-body text-ink">Your video is ready. Open the editor to make it yours.</p>
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={onOpen}>
            <ArrowUpRight aria-hidden className="size-4" />
            Open editor
          </button>
        </div>
      ) : (
        <p className="m-0 type-body text-ink-2">
          {approved ? 'Your approved story is becoming a video.' : 'Approve the current script and visual direction to create your video.'}
        </p>
      )}
    </div>
  );
}
