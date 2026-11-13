// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: trace-labels · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · running is violet (the agent at work), never blue; no sparkle for a model call
 * states: default
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { RunStatus, Span, SpanKind, SpanStatus, TraceGap } from '@taalcut/core';
import { Chip, type BadgeProps } from '@taalcut/ui';
import {
  BrainCircuit,
  CircleCheck,
  CircleDot,
  CircleSlash,
  CircleX,
  Footprints,
  Hand,
  LoaderCircle,
  Pause,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export const KINDS: Record<SpanKind, { label: MessageDescriptor; icon: LucideIcon; bar: string }> = {
  run: { label: msg`Run`, icon: CircleDot, bar: 'bg-rule-strong' },
  step: { label: msg`Step`, icon: Footprints, bar: 'bg-ink-3' },
  // The AI's own work carries violet (DESIGN.md: violet is the AI).
  model: { label: msg`Model call`, icon: BrainCircuit, bar: 'bg-ai-strong' },
  tool: { label: msg`Tool call`, icon: Wrench, bar: 'bg-ink-2' },
  // Waiting on the person: teal is "you".
  approval: { label: msg`Waiting for approval`, icon: Hand, bar: 'bg-you-strong' },
};

const SPAN_STATUS: Record<SpanStatus, MessageDescriptor> = {
  ok: msg`Finished`,
  error: msg`Failed`,
  cancelled: msg`Stopped`,
  running: msg`Running`,
};

export const STOP_REASONS: Record<NonNullable<Span['stopReason']>, MessageDescriptor> = {
  end: msg`Finished its answer`,
  tool_calls: msg`Asked for tools`,
  max_tokens: msg`Hit the length limit`,
};

export const SIDE_EFFECTS: Record<NonNullable<Span['sideEffect']>, MessageDescriptor> = {
  read: msg`Only reads`,
  write: msg`Changes something (undoable)`,
  destructive: msg`Deletes something`,
  external: msg`Sends something off this Mac`,
};

export const GAP_REASONS: Record<TraceGap['reason'], MessageDescriptor> = {
  'no-outcome': msg`a call with no outcome`,
  'no-tokens': msg`a token count`,
  'no-cost': msg`a cost`,
  'no-latency': msg`a time`,
};

const RUN_STATUS: Record<
  RunStatus,
  { label: MessageDescriptor; icon: LucideIcon; tone: BadgeProps['tone'] }
> = {
  // The agent at work is violet (DESIGN.md v0.2, Running status); blue never means running.
  running: { label: msg`Running`, icon: LoaderCircle, tone: 'ai' },
  paused: { label: msg`Paused`, icon: Pause, tone: 'warning' },
  succeeded: { label: msg`Succeeded`, icon: CircleCheck, tone: 'success' },
  failed: { label: msg`Failed`, icon: CircleX, tone: 'danger' },
  cancelled: { label: msg`Stopped`, icon: CircleSlash, tone: 'neutral' },
};

export function RunStatusChip({ status }: { status: RunStatus }) {
  const { i18n } = useLingui();
  const { label, icon: Icon, tone } = RUN_STATUS[status];
  return (
    <Chip tone={tone}>
      <Icon aria-hidden className={status === 'running' ? 'animate-spin' : undefined} />
      {i18n._(label)}
    </Chip>
  );
}

export function spanStatusLabel(status: SpanStatus): MessageDescriptor {
  return SPAN_STATUS[status];
}
