// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's TextTranslator over the ModelClient (SPEC P3.4): the `agent` module's chain (on-device under Local only,
 * where ModelClient drops cloud models; reasoning low in the cloud, off on this Mac), one forced `translations` tool
 * call validated by zod and by the output rules (translation-check.ts), one retry on an invalid answer, then
 * `models.translation_invalid`. At most 100 units a call; batching longer tracks is the caller's (core's
 * TRANSLATION_LIMITS). Each call is an ordinary chat CloudCall row (module `agent`), written by ModelClient.
 */
import {
  err,
  LocalOnly,
  ok,
  TRANSLATION_LIMITS,
  ValidationError,
  type Result,
  type TextTranslator,
  type TranslationUnit,
} from '@taalcut/core';
import { parseToolCall } from '../client/tools';
import type { ModelClient, ModelResult } from '../client/types';
import { NoModelForModule } from '../errors';
import { TranslationInvalid } from './errors';
import { checkTranslations } from './translation-check';
import { translationPlacement, type PlacementDeps, type TranslationPlacement } from './translation-placement';
import {
  TRANSLATIONS_TOOL,
  TRANSLATIONS_TOOL_NAME,
  translationMessage,
  translationSystem,
  type PromptInput,
} from './translation-prompt';

export interface TextTranslatorDeps extends PlacementDeps {
  readonly client: ModelClient;
}

type TranslateRequest = Parameters<TextTranslator['translate']>[0];
type Translated = ReturnType<TextTranslator['translate']>;

/** Answer tokens: units are short, and a unit's translation is at most twice its source. */
const MAX_TOKENS = 8_000;
const ATTEMPTS = 2;

/** The model's translations, or what was wrong with its answer (model-facing). */
function readAnswer(
  result: ModelResult,
  asked: readonly TranslationUnit[],
): Result<TranslationUnit[], string> {
  const call = result.toolCalls.find((c) => c.name === TRANSLATIONS_TOOL_NAME);
  if (!call) return err(`no ${TRANSLATIONS_TOOL_NAME} call`);
  const parsed = parseToolCall(TRANSLATIONS_TOOL, call);
  if (!parsed.ok) return err(parsed.error.detail ?? 'arguments did not validate');
  return checkTranslations(asked, parsed.value);
}

function checkUnits(units: readonly TranslationUnit[]): Result<void> {
  if (units.length === 0 || units.length > TRANSLATION_LIMITS.units)
    return err(ValidationError({ field: 'units' }, { detail: `1 to ${TRANSLATION_LIMITS.units} units` }));
  if (new Set(units.map((u) => u.id)).size !== units.length)
    return err(ValidationError({ field: 'units' }, { detail: 'unit ids repeat' }));
  return ok(undefined);
}

function promptInput(request: TranslateRequest): PromptInput {
  return {
    units: request.units,
    from: request.from,
    to: request.to,
    ...(request.context ? { context: request.context.slice(-TRANSLATION_LIMITS.context) } : {}),
    ...(request.instruction ? { instruction: request.instruction } : {}),
  };
}

/** One model call; `problem` tells it what was wrong with its last answer. */
function ask(
  deps: TextTranslatorDeps,
  request: TranslateRequest,
  where: TranslationPlacement,
  problem: string | undefined,
) {
  const input = promptInput(request);
  return deps.client.complete({
    module: 'agent',
    system: translationSystem(input, problem),
    messages: [{ role: 'user', content: translationMessage(input) }],
    tools: [TRANSLATIONS_TOOL],
    reasoning: where === 'local' ? 'off' : 'low',
    maxTokens: MAX_TOKENS,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.trace ? { trace: request.trace } : {}),
  });
}

async function translate(deps: TextTranslatorDeps, request: TranslateRequest): Translated {
  const checked = checkUnits(request.units);
  if (!checked.ok) return checked;
  const where = translationPlacement(deps);
  if (where === 'off')
    return err(deps.localOnly() ? LocalOnly({ what: 'model' }) : NoModelForModule({ module: 'agent' }));
  let problem: string | undefined;
  // Every attempt is paid for, the one whose answer was refused too.
  const usage = { inputTokens: 0, outputTokens: 0, usd: 0 };
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const result = await ask(deps, request, where, problem);
    if (!result.ok) return result;
    usage.inputTokens += result.value.usage.inputTokens;
    usage.outputTokens += result.value.usage.outputTokens;
    usage.usd += result.value.usage.costUsd;
    const answer = readAnswer(result.value, request.units);
    if (answer.ok) {
      const { provider, model, local } = result.value;
      return ok({ units: answer.value, provider, model, local, usage });
    }
    problem = answer.error;
  }
  return err(TranslationInvalid({ problem: problem ?? 'invalid answer' }, { detail: problem ?? '' }));
}

export function createTextTranslator(deps: TextTranslatorDeps): TextTranslator {
  return {
    placement: () => translationPlacement(deps),
    translate: (request) => translate(deps, request),
  };
}
