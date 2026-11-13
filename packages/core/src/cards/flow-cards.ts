// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Flow cards (P2-M13, P2-X1): the opening choices, a skill's step
 * card, the cost estimate before a step (version 2 of `costEstimate`),
 * the project budget cap and (G8) a model limit met mid-run. Step cards
 * carry a `flowStepRefSchema` so the window can show "Step 2 of 4" and the
 * "You changed this" mark.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { moneySchema } from '../basics/money';
import { OPENING_PATHS } from '../chat/chat-start';
import { billedSchema } from '../ports/model-ports';
import { jobProgressSchema } from '../jobs/job-types';
import { moduleIdSchema } from '../settings/models-contract';
import { USAGE_LIMIT_KINDS } from '../settings/usage-summary';
import { entityRefSchema, skillIdSchema } from '../skills/skill-refs';
import { amounts, base, cardRequesterSchema, runId } from './card-parts';

export const FLOW_STEP_STATUSES = ['waiting', 'running', 'ready', 'updating', 'failed', 'skipped'] as const;
export type FlowStepStatus = (typeof FLOW_STEP_STATUSES)[number];

/** Where a step card sits in its flow and what state the step is in. */
export const flowStepRefSchema = z.object({
  flowId: idSchema<'Flow'>(),
  stepId: z.string().min(1),
  /** 1-based, for "Step 2 of 4". */
  index: z.int().positive(),
  count: z.int().positive(),
  skill: skillIdSchema.optional(),
  status: z.enum(FLOW_STEP_STATUSES),
  /** The user changed what this step made (the "You changed this" mark). */
  editedByYou: z.boolean(),
});
export type FlowStepRef = z.output<typeof flowStepRefSchema>;

/** Which of the run's variants a card shows. */
export const flowVariantSchema = z.object({ index: z.int().positive(), count: z.int().min(1).max(10) });

/** A model the user could switch to, priced for the same work. */
export const cheaperOptionSchema = z.object({
  module: moduleIdSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  local: z.boolean(),
  estimate: moneySchema,
});
export type CheaperOption = z.output<typeof cheaperOptionSchema>;

export const openingChoicesCardSchema = z.object({
  type: z.literal('openingChoices'),
  ...base,
  /** Absent on a new chat, where the window shows the choices before any run. */
  runId: runId.optional(),
  paths: z.array(z.enum(OPENING_PATHS)).min(1).max(OPENING_PATHS.length),
  /** A path that can't run now, and why (i18n key). */
  unavailable: z.array(z.object({ path: z.enum(OPENING_PATHS), reasonKey: z.string().min(1) })),
  hasSources: z.boolean(),
  chosen: z.enum(OPENING_PATHS).optional(),
});

/** A skill's step in a flow; domain steps use their own cards (breakdown, castBoard, ...) with the same `step`. */
export const stepCardSchema = z.object({
  type: z.literal('step'),
  ...base,
  runId,
  step: flowStepRefSchema,
  labelKey: z.string().min(1),
  /** Model-written, in the user's language: what the step decided (e.g. the proposed brief). Plain text. */
  summary: z.string().max(2000).optional(),
  progress: jobProgressSchema.nullable().optional(),
  refs: z.array(entityRefSchema).max(20),
});

/** Version 2 of `costEstimate`: one per flow step, with lines per model, the project cap and cheaper options. */
export const costEstimateCardV2Schema = z.object({
  type: z.literal('costEstimate'),
  id: z.string().min(1),
  version: z.literal(2),
  runId,
  projectId: idSchema<'Project'>().nullable(),
  /** What the money is for: a skill's step or one tool call. */
  phase: z.object({
    labelKey: z.string().min(1),
    skill: skillIdSchema.optional(),
    tool: z.string().min(1).optional(),
  }),
  estimate: amounts,
  lines: z.array(
    z.object({
      module: moduleIdSchema,
      provider: z.string().min(1),
      model: z.string().min(1),
      local: z.boolean(),
      money: moneySchema,
      tokens: z.int().nonnegative(),
      /** P3: what the provider bills when it isn't tokens ("4 images", "1,240 characters"). */
      billed: billedSchema.optional(),
      /** The amount is an estimate ("about"). */
      estimated: z.boolean().optional(),
    }),
  ),
  /** The project's cap; null: no cap. */
  cap: z.object({ cap: moneySchema, spent: moneySchema }).nullable(),
  cheaper: z.array(cheaperOptionSchema),
  /** Set only when the card asks (the run budget); flow estimates go ahead. */
  approvalId: z.string().min(1).optional(),
  status: z.enum(['going-ahead', 'asking', 'switched', 'stopped', 'settled']),
  /** After the step: what it really cost. */
  actual: amounts.optional(),
});

/** The next step does not fit the project's cap; "Raise the cap" is BUDGET_COMMANDS.setProjectCap. */
export const budgetCapCardSchema = z.object({
  type: z.literal('budgetCap'),
  ...base,
  runId,
  projectId: idSchema<'Project'>(),
  approvalId: z.string().min(1),
  cap: moneySchema,
  spent: moneySchema,
  /** The step or call that doesn't fit. */
  next: z.object({ labelKey: z.string().min(1), estimate: moneySchema }),
  /** Spent plus the estimate, rounded up to the next US$0.50. */
  suggestedCap: moneySchema,
  cheaper: z.array(cheaperOptionSchema),
  status: z.enum(['pending', 'raised', 'switched', 'stopped', 'expired']),
  /** Round P3-3: an external agent's run met the cap (P3-V4); absent for the built-in agent and on older cards. */
  requester: cardRequesterSchema.optional(),
});

const modelRef = z.object({ provider: z.string().min(1), model: z.string().min(1) });
export const RATE_LIMIT_STATUSES = ['switched', 'waiting', 'resumed', 'stopped'] as const;

/**
 * G8: a model limit met a run: a switch it made, or a pause until the limit resets. Re-sent under the same id.
 * While it asks (`approvalId`), answer with chat.decideApproval and `{ kind: 'rateLimit', choice, model? }`
 * (choices: RATE_LIMIT_CHOICES).
 */
export const rateLimitCardSchema = z.object({
  type: z.literal('rateLimit'),
  ...base,
  runId,
  module: moduleIdSchema,
  reason: z.enum(USAGE_LIMIT_KINDS),
  status: z.enum(RATE_LIMIT_STATUSES),
  from: modelRef,
  /** Set when switched. */
  to: modelRef.extend({ local: z.boolean() }).optional(),
  resetsAt: z.int().nonnegative().nullable(),
  /** What the switch costs on top, when known. */
  extra: moneySchema.optional(),
  approvalId: z.string().min(1).optional(),
  /** The module's other configured options, cheapest first, local last; never paid ones under Local only. */
  options: z.array(modelRef.extend({ local: z.boolean(), estimate: moneySchema.optional() })).max(6),
  billingUrl: z.url({ protocol: /^https$/ }).optional(),
});
