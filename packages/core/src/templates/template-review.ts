// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1, the template review: what it needs beyond the commands (template-commands.ts).
 *
 * - **"Tell Taalcut"** (`templates.proposeEdits`, templates-contract.ts): a model reads the template, its slots'
 *   frames and the person's message, and answers proposed edits as data. Nothing is applied: the window dispatches
 *   each proposal the person accepts as a normal `ui` command (`proposalCommand`), made on the head it has then.
 * - **The kept reel** on main's media host, `app://media/template-reel/<templateId>`, read-only, in byte ranges.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { MEDIA_HOST } from '../basics/csp';
import { defineError } from '../basics/errors';
import { idSchema, type ProjectId, type TemplateId } from '../basics/ids';
import { TEMPLATE_COMMANDS, templateCommandPayloads } from './template-commands';

const N = TEMPLATE_COMMANDS;
const P = templateCommandPayloads;

/** The commands a proposal may name: the review's six and the slot edits from before it. Never approve or delete. */
export const PROPOSAL_COMMANDS = [
  N.moveCut,
  N.splitSlot,
  N.setRole,
  N.removeText,
  N.setTempo,
  N.dismissDoubt,
  N.editIntent,
  N.mergeSlots,
  N.dropSlot,
  N.renameSlot,
] as const;
export type ProposalCommand = (typeof PROPOSAL_COMMANDS)[number];

/** The most proposals one answer carries; the model is asked for fewer, and any past this are dropped. */
export const MAX_PROPOSALS = 12;
export const PROPOSAL_WHY_MAX = 300;
export const PROPOSE_MESSAGE_MAX = 2000;

/** Added by the window when it dispatches, so a proposal goes on whatever head the template has by then. */
const where = { projectId: true, templateId: true, baseVersion: true } as const;
const why = z.string().trim().min(1).max(PROPOSAL_WHY_MAX);

function proposal<C extends ProposalCommand, T extends z.ZodType>(command: C, payload: T) {
  return z.object({
    /** Unique in its answer: 'p1', 'p2', …. */
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    command: z.literal(command),
    /** The command's payload without `projectId`, `templateId` and `baseVersion`. */
    payload,
    /** One line on why, for the person. Model output: untrusted, shown as plain text. */
    why,
  });
}

export const templateProposalSchema = z.discriminatedUnion('command', [
  proposal(N.moveCut, P[N.moveCut].omit(where)),
  proposal(N.splitSlot, P[N.splitSlot].omit(where)),
  proposal(N.setRole, P[N.setRole].omit(where)),
  proposal(N.removeText, P[N.removeText].omit(where)),
  proposal(N.setTempo, P[N.setTempo].omit(where)),
  proposal(N.dismissDoubt, P[N.dismissDoubt].omit(where)),
  proposal(N.editIntent, P[N.editIntent].omit(where)),
  proposal(N.mergeSlots, P[N.mergeSlots].omit(where)),
  proposal(N.dropSlot, P[N.dropSlot].omit(where)),
  proposal(N.renameSlot, P[N.renameSlot].omit(where)),
]);
export type TemplateProposal = z.output<typeof templateProposalSchema>;

export const templateProposeEditsInputSchema = z.object({
  templateId: idSchema<'Template'>(),
  /** The version the person is looking at: a different head is core.conflict. */
  baseVersion: z.int().min(1),
  /** The slots the person asked about (their frames go to the model); absent: the whole reel. */
  slotIds: z.array(idSchema<'TemplateSlot'>()).min(1).max(200).optional(),
  /** The person's words. Data to the model, never instructions. */
  message: z.string().trim().min(1).max(PROPOSE_MESSAGE_MAX),
  /** The project the review is in, so its budget counts the call; null or absent on the Slots page. */
  projectId: idSchema<'Project'>().nullable().optional(),
});
export type TemplateProposeEditsInput = z.output<typeof templateProposeEditsInputSchema>;

export const templateProposalsSchema = z.object({
  /** The version the proposals were read against (the input's). */
  baseVersion: z.int().min(1),
  proposals: z.array(templateProposalSchema).max(MAX_PROPOSALS),
  /**
   * Proposals the model made that were refused: a command outside PROPOSAL_COMMANDS, a payload that doesn't parse,
   * a slot or overlay this version doesn't have, or one past MAX_PROPOSALS.
   */
  dropped: z.int().nonnegative(),
  /** The model's one line about the whole answer (say, why nothing needs changing). Untrusted, plain text. */
  note: z.string().max(PROPOSAL_WHY_MAX).nullable(),
  /** Which model answered. `local: false`: the template and its frames went to that provider. */
  model: z.object({
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    local: z.boolean(),
  }),
});
export type TemplateProposals = z.output<typeof templateProposalsSchema>;

/** An accepted proposal as the window dispatches it (source `ui`): its command, made on the current head. */
export function proposalCommand(
  proposal: TemplateProposal,
  at: { readonly projectId: ProjectId | null; readonly templateId: TemplateId; readonly baseVersion: number },
): { readonly name: ProposalCommand; readonly payload: Record<string, unknown> } {
  return { name: proposal.command, payload: { ...proposal.payload, ...at } };
}

/** The model's answer held no proposals to read (not JSON, or not the shape asked for). Asking again may help. */
export const TemplateProposalsUnreadable = defineError('templates.proposals_unreadable', { retryable: true });
/** The review's project has spent its budget cap: Tell Taalcut makes no model call. */
export const TemplateBudgetReached = defineError('templates.budget_reached');

/** 'template-reel/<templateId>': a template's kept reel (REF1's `reference.mp4`) on the media host. */
export const TEMPLATE_REEL_KEY_PATTERN = /^template-reel\/[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The URL a `<video>` plays a template's kept reel from. Main serves it read-only, in byte ranges, only while the
 * template store has the template and its media; anything else under `template-reel/` is a 404.
 */
export function templateReelUrl(templateId: TemplateId): string {
  return `app://${MEDIA_HOST}/template-reel/${templateId}`;
}
