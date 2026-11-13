// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Share card's check (P3-B12): the exact document that would be sent, and every content or structure problem
 * as a slot and a field. Core's hubContentProblems runs on the draft as it serialises (schema, size, NFC and the
 * content rules on every key and value), so the card shows what the Worker and the hub's CI would refuse. Problems
 * do not hide the document when it parses.
 */
import {
  hubContentProblems,
  hubTemplateV0Schema,
  MAX_HUB_PROBLEMS,
  type HubProblem,
  type HubShareForm,
  type ShareCheck,
  type Style,
  type Template,
} from '@taalcut/core';
import { fromHubTemplate, type HubIds } from './from-hub';
import { hubDraft, type HubTemplateMeta } from './to-hub';

const SLOT_PATH = /^structure\.slots\.(\d+)(?:\.|$)/;

export interface ShareCheckInput {
  readonly template: Template;
  readonly meta: HubTemplateMeta;
  readonly form: HubShareForm;
  readonly style: Style | null;
  readonly ids: HubIds;
  readonly now: number;
}

function locate(problem: HubProblem): ShareCheck['problems'][number] {
  const match = SLOT_PATH.exec(problem.path);
  const field =
    problem.path
      .split('.')
      .filter((part) => part.length > 0)
      .at(-1) ?? 'document';
  return {
    path: problem.path,
    rule: problem.rule,
    slotIndex: match ? Number(match[1]) : null,
    field: field.slice(0, 40),
  };
}

/** Builds the document, runs `hubContentProblems`, and round-trips it through Template v1. */
export function shareCheck(input: ShareCheckInput): ShareCheck {
  const draft = hubDraft(input.template, input.meta, input.form, input.style);
  const problems = hubContentProblems(draft);
  const parsed = hubTemplateV0Schema.safeParse(draft);
  if (!parsed.success) return { document: null, problems: problems.map(locate) };
  const round = fromHubTemplate(parsed.data, input.ids, input.now);
  if (!round.ok) problems.push({ path: '', rule: 'schema' });
  return { document: parsed.data, problems: problems.slice(0, MAX_HUB_PROBLEMS).map(locate) };
}
