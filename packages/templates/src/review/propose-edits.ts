// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `templates.proposeEdits` ("Tell Taalcut", BRK1-CMD): one model call with the template at the version the person
 * is looking at, its contact sheet and their message, answered as proposed edits. Nothing is applied here; the
 * window dispatches each one the person accepts as a normal command.
 *
 * The call goes through the app's model client (`ProposalModel`, which the agent process serves over its
 * ModelClient: the module's chain, Local only, the call log with the project and a span id). The project's budget
 * cap is checked first. The frames are a reference's, so (FIX-CONSENT) no consent card stands before them.
 */
import {
  ConflictError,
  err,
  ok,
  TemplateBudgetReached,
  type AsyncResult,
  type ProjectId,
  type TemplateProposals,
  type TemplateProposeEditsInput,
  type TemplatesService,
} from '@taalcut/core';
import { SlotNotFound } from '../errors';
import { readProposals } from './propose-answer';
import { PROPOSE_EDITS_PROMPT, proposeEditsText } from './propose-prompt';

/** Enough for a dozen proposals with their reasons. */
export const PROPOSE_MAX_TOKENS = 1600;

export type ProposalContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: 'image/jpeg' | 'image/webp' };

export interface ProposalModelRequest {
  readonly system: string;
  readonly content: readonly ProposalContent[];
  readonly maxTokens: number;
  /** The project whose budget counts the call; null outside a project. */
  readonly projectId: ProjectId | null;
}

export interface ProposalModelAnswer {
  /** Untrusted. */
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly local: boolean;
}

/** One model call for the review (the agent process serves it over its ModelClient). */
export interface ProposalModel {
  complete(request: ProposalModelRequest, signal?: AbortSignal): AsyncResult<ProposalModelAnswer>;
}

export interface ProposeEditsDeps {
  /** The template, migrated (the template service's `get`). */
  readonly templates: Pick<TemplatesService, 'get'>;
  readonly model: ProposalModel;
  /** A contact sheet's bytes by its sha256; absent or undefined: the model gets no frames. */
  readonly sheet?: (sha256: string) => Promise<Uint8Array | undefined>;
  /** True when the project's budget cap is spent; absent: no cap is checked. */
  readonly budgetReached?: (projectId: ProjectId) => AsyncResult<boolean>;
}

export function createProposeEdits(deps: ProposeEditsDeps) {
  return async function proposeEdits(
    input: TemplateProposeEditsInput,
    signal?: AbortSignal,
  ): AsyncResult<TemplateProposals> {
    const found = await deps.templates.get({ templateId: input.templateId });
    if (!found.ok) return found;
    const template = found.value.template;
    if (template.version !== input.baseVersion)
      return err(
        ConflictError(
          { entity: 'template', id: input.templateId },
          { detail: `Head ${template.version}, asked about ${input.baseVersion}` },
        ),
      );
    const slotIds = input.slotIds ?? [];
    if (slotIds.some((id) => !template.slots.some((slot) => slot.id === id))) return err(SlotNotFound());
    const projectId = input.projectId ?? null;
    if (projectId && deps.budgetReached) {
      const reached = await deps.budgetReached(projectId);
      if (!reached.ok) return reached;
      if (reached.value) return err(TemplateBudgetReached());
    }
    const sheet = template.contactSheet;
    const bytes = sheet && deps.sheet ? await deps.sheet(sheet.asset).catch(() => undefined) : undefined;
    const content: ProposalContent[] = [
      { type: 'text', text: proposeEditsText(template, slotIds, input.message) },
      ...(sheet && bytes
        ? [{ type: 'image' as const, data: Buffer.from(bytes).toString('base64'), mimeType: sheet.mediaType }]
        : []),
    ];
    const answer = await deps.model.complete(
      { system: PROPOSE_EDITS_PROMPT, content, maxTokens: PROPOSE_MAX_TOKENS, projectId },
      signal,
    );
    if (!answer.ok) return answer;
    const read = readProposals(answer.value.text, template);
    if (!read.ok) return read;
    const { provider, model, local } = answer.value;
    return ok({ baseVersion: template.version, ...read.value, model: { provider, model, local } });
  };
}
