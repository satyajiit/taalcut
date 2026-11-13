// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The models a ChatGPT plan's sign-in runs (UX3-AGT). Sign in with ChatGPT sends the plan's token to the API's
 * Responses endpoint (api.openai.com/v1/responses), and that route takes only the plan's own models: the API's
 * gpt-5.4, which Everyday's agent asked for, came back 400 models.unknown_model on the owner's machine. pi-ai's
 * `openai` provider treats every OpenAI chat model as open to the sign-in (it only drops the classifiers), and
 * neither pi-ai nor OpenAI's token-sharing guide gives a model list to call: the one the Codex CLI reads is
 * ChatGPT's backend-api, which token sharing must not call.
 *
 * So the plan's models are listed here: pi-ai 1.4.0's `openai-codex` catalogue, which matches ChatGPT's own list
 * as the Codex CLI fetched it on 2026-10-27 (less gpt-6.1-terra, which pi-ai doesn't list yet). Every id is in
 * pi-ai's `openai` catalogue too, which is what runs it. A pick of another OpenAI model goes out as its role's
 * plan model (registry/current-models.ts); when ChatGPT turns that one down anyway, the client tries the plan's
 * default once and says so (model-client.ts). Their reasoning levels on the plan are ChatGPT's: low to max,
 * without none or minimal (CHATGPT_PLAN_THINKING).
 */
import type { ReasoningLevel } from '../modules';
import { CURRENT_MODELS, roleOf } from '../registry/current-models';

/** The models the ChatGPT plan's sign-in accepts, newest first. */
export const CHATGPT_PLAN_MODELS = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const;

/**
 * The reasoning levels ChatGPT offers its plan's models: each model's supported_reasoning_levels in ChatGPT's
 * list (Codex CLI, 2026-10-27), less "ultra", Codex's delegation mode rather than a reasoning effort.
 */
export const CHATGPT_PLAN_THINKING: readonly ReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** What a role asks of OpenAI's models: the everyday workhorse, the fast and cheap one, or the best. */
export type ChatGPTPlanRole = 'everyday' | 'fast' | 'best';

const GPT = CURRENT_MODELS.openai!.openai!;
/** Each role's model on the plan: OpenAI's current models (ChatGPT's workhorse, fast and affordable, frontier). */
export const CHATGPT_PLAN_ROLES: Readonly<Record<ChatGPTPlanRole, (typeof CHATGPT_PLAN_MODELS)[number]>> = {
  everyday: GPT.everyday as 'gpt-6.1-sol',
  fast: GPT.fast as 'gpt-6-luna',
  best: GPT.best as 'gpt-6-astra',
};

/** What the plan runs when ChatGPT turns a mapped model down: its everyday model. */
export const CHATGPT_PLAN_DEFAULT = CHATGPT_PLAN_ROLES.everyday;

/** A model's role on the plan. */
export function planRoleOf(model: string): ChatGPTPlanRole {
  const role = roleOf(model);
  return role === 'frontier' ? 'best' : role;
}

/** The model to send on the ChatGPT plan for a pick: the pick when the plan has it, else its role's model. */
export function planModelFor(model: string): string {
  return (CHATGPT_PLAN_MODELS as readonly string[]).includes(model)
    ? model
    : CHATGPT_PLAN_ROLES[planRoleOf(model)];
}

/** The level to send on the plan: the nearest of ChatGPT's (none and minimal become low). */
export function planReasoning(level: ReasoningLevel): ReasoningLevel {
  return CHATGPT_PLAN_THINKING.includes(level) ? level : 'low';
}
