// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Payloads of the agent's events (PRD 7.1): what the chat, the plan card and
 * the trace viewer follow live. The agent's durable event log (P1-G2) is a
 * separate, richer record; these are the live notifications.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { referencePointerSchema } from '../chat/chat-start';
import { chatEffortSchema, chatThinkingSchema } from '../chat/effort';
import { SIDE_EFFECTS } from '../commands/definition';
import { skillIdSchema } from '../skills/skill-refs';
import { TOOL_CALL_SUMMARY_MAX } from '../tools/call-summary';

const runId = idSchema<'AgentRun'>();
const toolRunId = idSchema<'ToolRun'>();

export const PLAN_STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export const planStepSchema = z.object({
  id: z.string().min(1),
  /** Written by the model, in the user's language. */
  text: z.string(),
  status: z.enum(PLAN_STEP_STATUSES),
  /** The skill this step runs (flows seed one step per skill). */
  skill: skillIdSchema.optional(),
  /** Shown when `text` is empty: seeded flow steps carry a key, not model text. */
  labelKey: z.string().min(1).optional(),
});

export const BUDGET_KINDS = ['tokens', 'money', 'time'] as const;

export const agentRunStartedSchema = z.object({
  runId,
  conversationId: idSchema<'Conversation'>(),
  /** The effort the message was sent with. Absent: the model's own level. The chat keeps the latest. */
  effort: chatEffortSchema.optional(),
  /** UX3-AGT: the exact level the message was sent with, when the chat picked one. The chat keeps the latest. */
  reasoning: chatThinkingSchema.optional(),
  /**
   * Round P3-3 (P3-V15): the message's reference pointers, as the stored message carries them, so its chips
   * show while the run is live, not only after a reload. Absent when it had none.
   */
  pointers: z.array(referencePointerSchema).max(10).optional(),
});

export const agentPlanSchema = z.object({ runId, steps: z.array(planStepSchema) });

export const agentStepSchema = z.object({
  runId,
  stepId: z.string().min(1),
  status: z.enum(PLAN_STEP_STATUSES),
});

export const agentToolStartedSchema = z.object({
  runId,
  toolRunId,
  tool: z.string().min(1),
  sideEffect: z.enum(SIDE_EFFECTS),
});

export const agentToolFinishedSchema = z.object({
  runId,
  toolRunId,
  tool: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  durationMs: z.number().nonnegative(),
  error: publicErrorSchema.optional(),
  /**
   * FIX-TOOLGROUPS: what the call was about, for people, from the tool's `describeCall` ("IMG_0412.MOV · 0:48").
   * One plain line: file names and times, never a path, text from inside a file or the model's words. Absent when
   * the tool doesn't say, or the call failed before it had an answer.
   */
  summary: z.string().min(1).max(TOOL_CALL_SUMMARY_MAX).optional(),
});

/** One streamed chunk of an assistant message. */
export const agentMessageDeltaSchema = z.object({
  runId,
  messageId: idSchema<'Message'>(),
  delta: z.string(),
});

export const agentApprovalRequestedSchema = z.object({
  runId,
  approvalId: z.string().min(1),
  toolRunId: toolRunId.optional(),
  tool: z.string().min(1),
  sideEffect: z.enum(['write', 'destructive', 'external']),
  /** Why the agent wants to do it, written by the model. */
  reason: z.string(),
});

/** Units: tokens for 'tokens', micro-USD for 'money', milliseconds for 'time'. */
export const agentBudgetExceededSchema = z.object({
  runId,
  budget: z.enum(BUDGET_KINDS),
  limit: z.number().nonnegative(),
  used: z.number().nonnegative(),
});

export const agentRunFinishedSchema = z.object({
  runId,
  status: z.enum(['succeeded', 'failed', 'cancelled', 'paused']),
  error: publicErrorSchema.optional(),
});

/** One streamed chunk of the model's reasoning, shown folded above the answer. Plain text. */
export const agentReasoningDeltaSchema = z.object({ runId, delta: z.string() });
