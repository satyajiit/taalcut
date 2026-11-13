// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the chat's parts · mode: Operate · system: WEB2 Remix Vernacular (A1 messages, A3 the run, A12 running is
 *   violet; decision cards raised with a hairline, never a second marigold)
 * rebuilt lean from packages/ui/src/chat/{message,run-block,status-mark}.tsx: your words in a bubble on the right
 *   ("You" for screen readers), the reel you pasted as a chip; the agent's words unboxed after the AI mark and
 *   "Taalcut"; the run as its name and count, then its four steps two by two, each with a status mark (violet and
 *   turning while it runs, the AI's tick when done, a hollow ring before) and what it found, kept in its place
 *   until the step is done so the run never changes size; then its picture (the check strip)
 * states: step pending · running · done (said in words to screen readers) · the agent's line: working (its mark
 *   turning) · said
 * motion: the running mark turns; reduced motion: it holds still */

import type { ReactNode } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { cn } from '#lib/cn';
import { Chip } from '../chip';
import { SHOWCASE_ICONS } from '../icons';
import { RUN_NAME, STEPS, type StepStatus } from './run-script';

export function UserMessage({ text, attachment }: { readonly text: string; readonly attachment?: string }) {
  const Reel = SHOWCASE_ICONS.reel;
  return (
    <article className="flex max-w-[min(30rem,88%)] flex-col gap-2 self-end rounded-2xl rounded-br-sm bg-bubble px-4 py-3">
      <span className="sr-only">You: </span>
      {attachment ? (
        <Chip tone="beat" className="max-w-full">
          <Reel aria-hidden />
          <span className="min-w-0 whitespace-normal">{attachment}</span>
        </Chip>
      ) : null}
      <p className="m-0 type-prose text-ink">{text}</p>
    </article>
  );
}

export function AgentMessage({
  text,
  working = false,
}: {
  readonly text: string;
  readonly working?: boolean;
}) {
  const Running = SHOWCASE_ICONS.running;
  return (
    <article className="flex max-w-prose flex-col gap-1">
      <header className="flex items-center gap-2 type-label-sm text-ink-2">
        <AiMark className="size-3.5 text-ai-strong" />
        Taalcut
      </header>
      <p className={cn('m-0 flex items-center gap-2 type-prose', working ? 'text-ink-2' : 'text-ink')}>
        {working ? (
          <Running
            aria-hidden
            className="size-4 shrink-0 animate-spin text-ai-strong motion-reduce:animate-none"
          />
        ) : null}
        {text}
      </p>
    </article>
  );
}

const STATUS_WORDS: Record<StepStatus, string> = {
  pending: 'Not started',
  running: 'In progress',
  done: 'Done',
};

function StatusMark({ status }: { readonly status: StepStatus }) {
  const Icon =
    status === 'done'
      ? SHOWCASE_ICONS.passed
      : status === 'running'
        ? SHOWCASE_ICONS.running
        : SHOWCASE_ICONS.pending;
  return (
    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
      <Icon
        aria-hidden
        strokeWidth={2.25}
        className={cn(
          'size-4',
          status === 'running' && 'animate-spin text-ai-strong motion-reduce:animate-none',
          status === 'done' && 'text-violet-strong',
          status === 'pending' && 'text-rule-strong',
        )}
      />
      <span className="sr-only">{STATUS_WORDS[status]}: </span>
    </span>
  );
}

export function RunBlock({
  steps,
  children,
}: {
  readonly steps: readonly StepStatus[];
  readonly children?: ReactNode;
}) {
  const done = steps.filter((s) => s === 'done').length;
  const working = steps.some((s) => s === 'running');
  return (
    <section
      aria-label={`Plan, ${done} of ${STEPS.length} steps done`}
      data-working={working || undefined}
      className="@container flex min-w-0 flex-col gap-3"
    >
      <p className="m-0 inline-flex w-fit items-center gap-2 rounded-md border border-rule-subtle bg-chip px-2.5 py-1 type-label-sm text-ink-2">
        <span className="text-ink">{RUN_NAME}</span>
        <span aria-hidden className="text-ink-3">
          ·
        </span>
        <span className="tabular-nums">
          {done} of {STEPS.length} done
        </span>
      </p>
      <ol className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 @min-[30rem]:grid-cols-2">
        {STEPS.map((step, i) => {
          const status = steps[i] ?? 'pending';
          return (
            <li key={step.id} data-step-status={status} className="flex items-start gap-2.5">
              <StatusMark status={status} />
              <span className="flex min-w-0 flex-col">
                <span className={cn('type-label', status === 'pending' ? 'text-ink-2' : 'text-ink')}>
                  {step.text}
                </span>
                <span className={cn('type-meta text-ink-2', status !== 'done' && 'invisible')}>
                  {step.found}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {children}
    </section>
  );
}
