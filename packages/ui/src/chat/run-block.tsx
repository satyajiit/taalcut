// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: run-block · mode: Operate · system: DESIGN.md (A3, A12)
 * One activity disclosure follows the result. Steps, calls, reasoning and settled costs share that level.
 * States: running · paused · succeeded · failed · cancelled · open/closed · hover/focus/press.
 * Errors and live spending controls remain outside the collapse. History never announces itself.
 * Motion: Collapse and a chevron report the user's choice; reduced motion removes their travel. */

import { useLingui } from '@lingui/react/macro';
import type { CardOf, CostEstimateCardV2 } from '@taalcut/core';
import { memo, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Collapse } from '#components/collapse';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';
import { CostEstimateV2Card } from '../cards/cost-estimate-v2-card';
import { flowStepLabel } from '../cards/flow-labels';
import { ToolRunRow } from '../cards/tool-run-card';
import { StatusMark } from './status-mark';
import { RunActivityHeading } from './run-activity-heading';
import type { RunTool } from './tool-groups';
import { ToolRunList } from './tool-run-group';

export type { RunTool } from './tool-groups';
type PlanStep = CardOf<'plan'>['steps'][number];
type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';

export interface RunBlockProps {
  plan?: CardOf<'plan'>;
  /** The run's tool calls, oldest first. */
  tools?: readonly RunTool[];
  /** Non-blocking costs; any live spending controls remain visible. */
  costs?: readonly CostEstimateCardV2[];
  status?: RunStatus;
  /** True only while provider reasoning is arriving; never inferred from a tool name. */
  thinking?: boolean;
  /** A visible answer already carries the live state, so its activity header stays quiet. */
  responding?: boolean;
  /** A short view of the genuine current reasoning, while the activity is closed. */
  preview?: ReactNode;
  /** Earlier commentary and reasoning, without their own disclosures. */
  children?: ReactNode;
  className?: string;
}

const EMPTY_TOOLS: readonly RunTool[] = [];
const EMPTY_COSTS: readonly CostEstimateCardV2[] = [];

function StepRow({ step, tools }: { step: PlanStep; tools: readonly RunTool[] }) {
  const { i18n } = useLingui();
  const keyed = step.text.trim() === '' && step.labelKey !== undefined;
  return (
    <li data-step-status={step.status} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-2 type-label text-ink-2">
        <StatusMark status={step.status} className="mt-0.5 shrink-0" />
        <span className={cn('min-w-0 break-words', step.status === 'skipped' && 'line-through')}>
          {keyed ? flowStepLabel(i18n, step.labelKey) : <UserContent>{step.text}</UserContent>}
        </span>
      </div>
      {tools.length > 0 ? (
        <ToolRunList tools={tools} arrives={() => false} as="div" className="ps-6" />
      ) : null}
    </li>
  );
}

function inferredStatus(steps: readonly PlanStep[], tools: readonly RunTool[]): RunStatus {
  if (
    tools.some(({ card }) => card.status === 'running') ||
    steps.some((step) => step.status === 'running' || step.status === 'pending')
  )
    return 'running';
  if (tools.some(({ card }) => card.status === 'failed') || steps.some((step) => step.status === 'failed'))
    return 'failed';
  return tools.some(({ card }) => card.status === 'cancelled') ? 'cancelled' : 'succeeded';
}

/** One disclosure for everything the run did; user decisions and recovery are never inside it. */
export const RunBlock = memo(function RunBlock({
  plan,
  tools = EMPTY_TOOLS,
  costs = EMPTY_COSTS,
  status,
  thinking = false,
  responding = false,
  preview,
  children,
  className,
}: RunBlockProps) {
  const { t, i18n } = useLingui();
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const steps = plan?.steps ?? [];
  const state = status ?? inferredStatus(steps, tools);
  const working = state === 'running';
  const previous = useRef(state);
  const [announcement, setAnnouncement] = useState('');
  if (previous.current !== state) {
    previous.current = state;
    setAnnouncement(
      state === 'succeeded'
        ? t`Activity complete`
        : state === 'failed'
          ? t`Activity needs attention`
          : state === 'cancelled'
            ? t`Activity stopped`
            : '',
    );
  }
  const failures = tools.filter(({ card }) => card.status === 'failed' || card.error !== undefined);
  const { toolsByStep, loose } = useMemo(() => {
    const ids = new Set(steps.map((step) => step.id));
    const grouped = new Map<string, RunTool[]>();
    const ungrouped: RunTool[] = [];
    for (const tool of tools) {
      if (tool.card.status === 'failed' || tool.card.error !== undefined) continue;
      if (tool.stepId !== undefined && ids.has(tool.stepId)) {
        grouped.set(tool.stepId, [...(grouped.get(tool.stepId) ?? []), tool]);
      } else ungrouped.push(tool);
    }
    return { toolsByStep: grouped, loose: ungrouped };
  }, [steps, tools]);
  const activeCosts = costs.filter((card) => card.status === 'going-ahead' || card.status === 'asking');
  const settledCosts = costs.filter((card) => card.status !== 'going-ahead' && card.status !== 'asking');
  const detail =
    state === 'paused'
      ? t`Waiting for you`
      : state === 'cancelled'
        ? t`Stopped`
        : state === 'failed'
          ? t`Needs attention`
          : undefined;
  return (
    <section
      data-slot="run-block"
      data-card-type={plan ? 'plan' : 'run'}
      data-working={working || undefined}
      aria-label={t`Activity`}
      className={cn('relative flex min-w-0 max-w-[65ch] flex-col gap-2', className)}
    >
      {failures.map(({ card }) => (
        <ToolRunRow key={card.id} card={card} />
      ))}
      {steps
        .filter((step) => step.status === 'failed')
        .map((step) => (
          <div key={step.id} className="flex items-start gap-2 type-body text-ink-2">
            <StatusMark status="failed" className="mt-0.5 shrink-0" />
            <UserContent>{step.text || flowStepLabel(i18n, step.labelKey)}</UserContent>
          </div>
        ))}
      {activeCosts.map((card) => (
        <CostEstimateV2Card key={card.id} card={card} presentation="inline" />
      ))}
      <RunActivityHeading
        working={working && !responding}
        thinking={thinking}
        label={t`Activity`}
        detail={detail}
        open={open}
        regionId={regionId}
        onToggle={() => setOpen(!open)}
      />
      {working && thinking && !open && preview ? (
        <div data-slot="run-live-preview" className="line-clamp-3 min-w-0 text-sm text-ink-2">
          {preview}
        </div>
      ) : null}
      <span data-slot="run-announcement" role="status" className="sr-only">
        {announcement}
      </span>
      <Collapse id={regionId} data-slot="run-activity" open={open}>
        <div className="flex min-w-0 flex-col gap-4 border-s border-rule-subtle py-1 ps-4">
          {children ? (
            <div data-slot="run-notes" className="flex min-w-0 flex-col gap-3 text-sm text-ink-2">
              {children}
            </div>
          ) : null}
          {plan?.title ? (
            <p className="m-0 type-label text-ink-2">
              <UserContent>{plan.title}</UserContent>
            </p>
          ) : null}
          {steps.length > 0 ? (
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              {steps.map((step) => (
                <StepRow key={step.id} step={step} tools={toolsByStep.get(step.id) ?? EMPTY_TOOLS} />
              ))}
            </ol>
          ) : null}
          {loose.length > 0 ? <ToolRunList tools={loose} arrives={() => false} /> : null}
          {settledCosts.length > 0 ? (
            <div data-slot="run-costs" className="flex flex-col gap-3">
              {settledCosts.map((card) => (
                <CostEstimateV2Card key={card.id} card={card} presentation="inline" />
              ))}
            </div>
          ) : null}
        </div>
      </Collapse>
    </section>
  );
});
