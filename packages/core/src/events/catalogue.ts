// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The event catalogue: every event that crosses a process boundary, as one
 * zod discriminated union. An event is `{ type, at, payload }`; `at` is the
 * emitter's clock in epoch ms and survives every hop. Adding an event type is
 * a core contract change. See packages/core/SPEC.md, "Event bus".
 */
import '../basics/zod-config';
import { z } from 'zod';
import { DERIVED_KEY_PATTERN } from '../analysis/media-facts';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { cardSchema } from '../cards/cards';
import { COMMAND_SOURCES, commandNameSchema } from '../commands/definition';
import { computeFallbackEventSchema } from '../compute/backend';
import { themeStateSchema } from '../ipc/theme-contract';
import { downloadsSchema } from '../settings/component-schema';
import { JOB_STATES, jobKindSchema, jobProgressSchema } from '../jobs/job-types';
import { indexMilestoneEventSchema } from '../library/index-milestones';
import { indexingStatusSchema } from '../library/indexing';
import { transferFileSchema, transferSessionSchema } from '../transfer/transfer-contract';
import { deviceRunSchema, deviceViewSchema } from '../transfer/devices-contract';
import {
  agentApprovalRequestedSchema,
  agentBudgetExceededSchema,
  agentMessageDeltaSchema,
  agentPlanSchema,
  agentReasoningDeltaSchema,
  agentRunFinishedSchema,
  agentRunStartedSchema,
  agentStepSchema,
  agentToolFinishedSchema,
  agentToolStartedSchema,
} from './agent-events';
import { LIBRARY_ENTITIES } from './library-entities';
import { uiActionSchema } from './ui-actions';

function event<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({ type: z.literal(type), at: z.int().nonnegative(), payload });
}

const jobId = idSchema<'Job'>();
const projectId = idSchema<'Project'>().nullable();

export { LIBRARY_ENTITIES, type LibraryEntity } from './library-entities';

/** What a run streams to the chat (the agent's live notifications). */
const AGENT_EVENTS = [
  event('agent.runStarted', agentRunStartedSchema),
  event('agent.plan', agentPlanSchema),
  event('agent.step', agentStepSchema),
  event('agent.toolStarted', agentToolStartedSchema),
  event('agent.toolFinished', agentToolFinishedSchema),
  event('agent.messageDelta', agentMessageDeltaSchema),
  event('agent.reasoningDelta', agentReasoningDeltaSchema),
  event('agent.approvalRequested', agentApprovalRequestedSchema),
  event('agent.budgetExceeded', agentBudgetExceededSchema),
  event('agent.runFinished', agentRunFinishedSchema),
  /** A smart card to show or update in the conversation (section 9 of the SPEC). */
  event('agent.card', z.object({ runId: idSchema<'AgentRun'>(), card: cardSchema })),
] as const;

/** The `agent.*` events only: what the chat contract streams. */
export const agentEventSchema = z.discriminatedUnion('type', AGENT_EVENTS);

export const taalcutEventSchema = z.discriminatedUnion('type', [
  event('job.progress', z.object({ jobId, kind: jobKindSchema, projectId, progress: jobProgressSchema })),
  event(
    'job.stateChanged',
    z.object({
      jobId,
      kind: jobKindSchema,
      projectId,
      /** null when the job was just created. */
      from: z.enum(JOB_STATES).nullable(),
      to: z.enum(JOB_STATES),
      attempt: z.int().positive(),
      error: publicErrorSchema.optional(),
    }),
  ),
  ...AGENT_EVENTS,
  event(
    'library.changed',
    z.object({
      projectId,
      entity: z.enum(LIBRARY_ENTITIES),
      change: z.enum(['created', 'updated', 'deleted']),
      ids: z.array(z.string()).max(1000),
    }),
  ),
  /** Media evicted derived files from its cache (over the cap, or a stale recipe); library clears the refs. */
  event(
    'media.derivedEvicted',
    z.object({
      keys: z.array(z.string().regex(DERIVED_KEY_PATTERN)).max(1000),
      freedBytes: z.int().nonnegative(),
    }),
  ),
  /** A render reached a final state. Main posts a notification when `notify` is set ("Notify me"). */
  event(
    'render.finished',
    z.object({
      renderId: idSchema<'Render'>(),
      projectId: idSchema<'Project'>(),
      status: z.enum(['ready', 'needsAttention', 'failed', 'cancelled']),
      notify: z.boolean(),
      /** The render's display name. */
      name: z.string().min(1).max(200),
    }),
  ),
  /** Indexing progress from the jobs process: at most 2 a second, only when something changed. */
  event('library.indexing', indexingStatusSchema),
  /** Round IX: assets reached an index milestone (searchable, complete); the library stores when. */
  event('library.indexMilestone', indexMilestoneEventSchema),
  /** A Wi-Fi import session changed (no pairing secrets: those go only to the window that opened it). */
  event('transfer.session', transferSessionSchema),
  /** An upload moved on: at most 4 a second per file. */
  event('transfer.file', transferFileSchema),
  /** P3-B4, P3-B5: a USB device appeared, changed access, or went. */
  event('transfer.device', deviceViewSchema),
  /** A USB import run's state, at most 4 a second; main keeps the lan process alive while one runs. */
  event('transfer.deviceRun', deviceRunSchema),
  /**
   * UX2-DOWNLOADER: the download of everything this Mac needs moved on, from the jobs process: at most 4 a second
   * while it runs, and at each change of state. Main posts a notification when it reaches `ready`.
   */
  event('components.downloads', downloadsSchema),
  event('theme.changed', themeStateSchema),
  /** Work ran on the CPU instead of a GPU/NPU (ADR 0002), with the reason. */
  event('compute.fallback', computeFallbackEventSchema),
  event(
    'command.changed',
    z.object({
      kind: z.enum(['executed', 'undone', 'redone']),
      id: idSchema<'Command'>(),
      name: commandNameSchema,
      projectId,
      source: z.enum(COMMAND_SOURCES),
      actor: z.string(),
    }),
  ),
  /** Asks the renderer to run a palette item: the app menu, settings.openSignInWarning (ui-actions.ts). */
  event('ui.action', uiActionSchema),
  /**
   * Main's recovery report changed after launch: the agent process was restarted after a crash
   * and runs stopped partway. The renderer reads recovery.report again and offers the prompt.
   */
  event(
    'recovery.changed',
    z.object({ reason: z.enum(['agent-restarted']), unfinishedRuns: z.int().nonnegative() }),
  ),
]);

export type TaalcutEvent = z.output<typeof taalcutEventSchema>;
export type EventType = TaalcutEvent['type'];
export type EventOf<T extends EventType> = Extract<TaalcutEvent, { type: T }>;
export type EventPayload<T extends EventType> = EventOf<T>['payload'];

export const EVENT_TYPES: readonly EventType[] = taalcutEventSchema.options.map(
  (option) => option.shape.type.value,
);

export const eventTypeSchema = z.enum(EVENT_TYPES);
