// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The smart-card payload protocol (R21, P1-H4). The agent emits typed card
 * payloads; the renderer maps each `type` to one component in packages/ui.
 * Adding a card is one schema here and one component there. Payloads are
 * data, never markup: model-written text is plain text, fixed UI strings are
 * i18n keys. Phase 2's flow cards are in flow-cards.ts, the domain steps'
 * in domain-cards.ts. See packages/core/SPEC.md, "Card protocol".
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { defineError, ValidationError } from '../basics/errors';
import { idSchema } from '../basics/ids';
import { err, ok, type Result } from '../basics/result';
import { planStepSchema } from '../events/agent-events';
import { JOB_STATES, jobProgressSchema } from '../jobs/job-types';
import { upgradeStoredCard } from './card-upgrade';
import { amounts, base, cardRequesterSchema, runId } from './card-parts';
import {
  breakdownCardSchema,
  castBoardCardSchema,
  exportApprovalCardSchema,
  importProgressCardSchema,
  qaReportCardSchema,
  renderProgressCardSchema,
  sourcePickerCardSchema,
  timelineCardSchema,
} from './domain-cards';
import {
  budgetCapCardSchema,
  costEstimateCardV2Schema,
  openingChoicesCardSchema,
  rateLimitCardSchema,
  stepCardSchema,
} from './flow-cards';
import {
  cleanupPlanCardSchema,
  gapFixCardSchema,
  hubResultsCardSchema,
  styleBatchCardSchema,
  variantsCompareCardSchema,
} from './content-cards';
import {
  imageTakesCardSchema,
  motionGraphicCardSchema,
  renderBatchCardSchema,
  voiceConsentCardSchema,
  voiceoverCardSchema,
} from './media-cards';
import { editChangesCardSchema } from './edit-changes-card';
import { memoryProposalCardSchema } from './memory-cards';
import { publishPackCardSchema } from './publish-pack-card';
import { soundResultsCardSchema } from './sound-cards';
import { styleProfileCardSchema } from './style-profile-cards';

export { cardRequesterSchema } from './card-parts';
export type CardRequester = z.output<typeof cardRequesterSchema>;

const changingEffect = z.enum(['write', 'destructive', 'external']);

export const planCardSchema = z.object({
  type: z.literal('plan'),
  ...base,
  runId,
  title: z.string().optional(),
  steps: z.array(planStepSchema),
});

export const approvalCardSchema = z.object({
  type: z.literal('approval'),
  ...base,
  runId,
  approvalId: z.string().min(1),
  tool: z.string().min(1),
  sideEffect: changingEffect,
  /** What will happen, written by the model. */
  summary: z.string(),
  details: z.string().optional(),
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
  expiresAt: z.int().nonnegative().optional(),
  /** P3-V4: who asked, when it wasn't the built-in agent (an external agent's session); absent on older cards. */
  requester: cardRequesterSchema.optional(),
});

/** Version 1: the run budget's stop-and-ask card (G8). Version 2 is in flow-cards.ts. */
export const costEstimateCardV1Schema = z.object({
  type: z.literal('costEstimate'),
  ...base,
  runId,
  tool: z.string().optional(),
  estimate: amounts,
  /** What is left of the run's budget. */
  remaining: amounts.optional(),
  requiresApproval: z.boolean(),
  approvalId: z.string().optional(),
});

/** Both versions, told apart by `version`. */
export const costEstimateCardSchema = z.discriminatedUnion('version', [
  costEstimateCardV1Schema,
  costEstimateCardV2Schema,
]);

export const UPLOAD_SOURCES = ['user-media', 'reference'] as const;
export type UploadSource = (typeof UPLOAD_SOURCES)[number];

/**
 * Before the user's media leaves the device (PRD G9): which tool, which
 * cloud modules and the providers they may send to, which files, and the
 * cost. The buttons are `options`; "Always allow" stores a standing consent
 * for these modules, and each later upload is still logged as an approval.
 */
export const consentCardSchema = z.object({
  type: z.literal('consent'),
  ...base,
  runId,
  /** Answer with this id (chat.decideApproval), like an approval card. */
  approvalId: z.string().min(1),
  tool: z.string().min(1),
  upload: z.object({
    /** Cloud modules the tool uses, e.g. ['vision']. */
    modules: z.array(z.string().min(1)).min(1),
    /** Providers those modules may send to now. */
    providers: z.array(z.string().min(1)),
    /** Files whose content would leave the device. */
    files: z.array(z.string()),
    /** Where each file comes from ('user-media' or 'reference', in `files` order; when omitted, user media). */
    sources: z.array(z.enum(UPLOAD_SOURCES)).optional(),
  }),
  estimate: amounts.optional(),
  options: z.array(z.enum(['allow-once', 'always-allow', 'deny'])).min(1),
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
  /** Round P3-3: an external agent's run asked (P3-V4); absent for the built-in agent and on older cards. */
  requester: cardRequesterSchema.optional(),
});

/** The cause and, when the error has one, a fix button (error.fix). */
export const errorCardSchema = z.object({ type: z.literal('error'), ...base, error: publicErrorSchema });

export const progressCardSchema = z.object({
  type: z.literal('progress'),
  ...base,
  jobId: idSchema<'Job'>().optional(),
  /** i18n key, e.g. 'cards.progress.indexingLibrary'. */
  labelKey: z.string().min(1),
  state: z.enum(JOB_STATES),
  progress: jobProgressSchema.nullable(),
});

export const toolRunCardSchema = z.object({
  type: z.literal('toolRun'),
  ...base,
  runId,
  toolRunId: idSchema<'ToolRun'>(),
  tool: z.string().min(1),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  startedAt: z.int().nonnegative(),
  finishedAt: z.int().nonnegative().optional(),
  summary: z.string().optional(),
  error: publicErrorSchema.optional(),
  /** Large outputs are artifacts, shown by reference. */
  artifactIds: z.array(z.string()).optional(),
  /** A committed cover stays downloadable even when its chat run was cancelled while saving. No paths. */
  savedCover: z
    .object({
      fileName: z
        .string()
        .min(1)
        .regex(/^[^/\\]+\.jpe?g$/iu),
      assetId: idSchema<'Asset'>().optional(),
      width: z.int().positive(),
      height: z.int().positive(),
      revision: z.int().positive(),
    })
    .optional(),
});

export const cardSchema = z.discriminatedUnion('type', [
  planCardSchema,
  approvalCardSchema,
  consentCardSchema,
  costEstimateCardSchema,
  errorCardSchema,
  progressCardSchema,
  toolRunCardSchema,
  openingChoicesCardSchema,
  stepCardSchema,
  budgetCapCardSchema,
  sourcePickerCardSchema,
  importProgressCardSchema,
  breakdownCardSchema,
  castBoardCardSchema,
  timelineCardSchema,
  renderProgressCardSchema,
  qaReportCardSchema,
  exportApprovalCardSchema,
  // Phase 3 (round P3-1).
  rateLimitCardSchema,
  variantsCompareCardSchema,
  gapFixCardSchema,
  hubResultsCardSchema,
  cleanupPlanCardSchema,
  styleBatchCardSchema,
  voiceoverCardSchema,
  voiceConsentCardSchema,
  motionGraphicCardSchema,
  renderBatchCardSchema,
  imageTakesCardSchema,
  // Learning round 1 (LRN1-MEM).
  memoryProposalCardSchema,
  // Learning round 1 (LRN1-STY).
  styleProfileCardSchema,
  // Editor round 1 (EDT1-CTX).
  editChangesCardSchema,
  // Publishing pack (thumbnails + social metadata).
  publishPackCardSchema,
  // Earshot round 1 (EAR1-K2).
  soundResultsCardSchema,
]);

export type Card = z.output<typeof cardSchema>;
export type CardType = Card['type'];
export type CardOf<T extends CardType> = Extract<Card, { type: T }>;
export type CostEstimateCardV1 = z.output<typeof costEstimateCardV1Schema>;
export type CostEstimateCardV2 = z.output<typeof costEstimateCardV2Schema>;

type CardOption = (typeof cardSchema.options)[number];
interface CardObject {
  readonly shape: { readonly type: { readonly value: string }; readonly version: { readonly value: number } };
}

/** A card type's schemas: one, or one per version. */
function versionsOf(option: CardOption): readonly CardObject[] {
  return ('options' in option ? option.options : [option]) as readonly CardObject[];
}

/** Each card type with the versions this build knows. */
const KNOWN_VERSIONS: ReadonlyMap<string, readonly number[]> = new Map(
  cardSchema.options.map((option) => {
    const versions = versionsOf(option);
    return [versions[0]!.shape.type.value, versions.map((v) => v.shape.version.value)] as const;
  }),
);

export const CARD_TYPES: readonly CardType[] = [...KNOWN_VERSIONS.keys()] as CardType[];

/** The card's type is known but this version isn't: the renderer shows its generic fallback card. */
export const CardUnsupported = defineError<{ type: string; version: string }>('core.card_unsupported');

/** Validates a card from the agent or from a stored conversation. */
export function parseCard(value: unknown): Result<Card> {
  const parsed = cardSchema.safeParse(upgradeStoredCard(value));
  if (parsed.success) return ok(parsed.data);
  const { type, version } = (value ?? {}) as { type?: unknown; version?: unknown };
  const known = typeof type === 'string' ? KNOWN_VERSIONS.get(type) : undefined;
  if (known === undefined || typeof version !== 'number' || !known.includes(version)) {
    return err(CardUnsupported({ type: String(type), version: String(version) }));
  }
  const issue = parsed.error.issues[0];
  const field = issue?.path.map(String).join('.') || undefined;
  return err(ValidationError(field ? { field } : undefined, { detail: parsed.error.message }));
}
