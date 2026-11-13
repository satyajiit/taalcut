// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The System One wire format over our own fetch (models SPEC P3.5): TypeSafe's documented
 * `POST https://api.typesafe.ai/v1/systemone` and Cloudflare's documented Clef curl
 * `POST …/accounts/{account}/ai/run/@cf/cloudflare/<model>`, both a flat `{ model, state, questions }` body
 * with Bearer auth. pi-ai 1.1.0 knew only `jev-latest` (priced at US$0; 1.4.0 too), posted Clef in the
 * `{ model, input }` envelope of Cloudflare's third-party wrapper and dropped the resolved `model` from the answer,
 * so the router doesn't go through it for these two providers.
 */
import { err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import { ModelNotConfigured, ModelProviderError } from '../errors';
import type { ClassifierAnswer, ClassifierQuestion } from './classifier-types';

export const TYPESAFE_PROVIDER = 'typesafe';
export const CLOUDFLARE_PROVIDER = 'cloudflare-workers-ai';
export const SYSTEM_ONE_PROVIDERS: readonly string[] = [TYPESAFE_PROVIDER, CLOUDFLARE_PROVIDER];

const TYPESAFE_BASE = 'https://api.typesafe.ai/v1/';
const CLOUDFLARE_BASE = 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai';
const ACCOUNT_PLACEHOLDER = '{CLOUDFLARE_ACCOUNT_ID}';

export interface SystemOneCall {
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/** The URL and body for one classification; `baseUrl` replaces the provider's documented host (tests). */
export function systemOneCall(input: {
  readonly provider: string;
  readonly model: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, ClassifierQuestion>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly baseUrl?: string;
}): Result<SystemOneCall> {
  const questions = wireQuestions(input.questions);
  if (input.provider === TYPESAFE_PROVIDER) {
    const base = (input.baseUrl ?? TYPESAFE_BASE).replace(/\/+$/u, '');
    return ok({ url: `${base}/systemone`, body: { model: input.model, state: input.state, questions } });
  }
  const account = input.env?.CLOUDFLARE_ACCOUNT_ID;
  if (!account || !/^[A-Za-z0-9]{1,64}$/.test(account))
    return err(
      ModelNotConfigured(
        { provider: input.provider, model: input.model },
        { detail: 'Clef needs the Cloudflare account id with the token.' },
      ),
    );
  const base = (input.baseUrl ?? CLOUDFLARE_BASE).replace(ACCOUNT_PLACEHOLDER, account).replace(/\/+$/u, '');
  // The URL names the catalogue id; the body names the short one (clef, clef-flash), and they must match.
  const short = input.model.split('/').at(-1) ?? input.model;
  return ok({ url: `${base}/run/${input.model}`, body: { model: short, state: input.state, questions } });
}

/** Public `bool` questions are `noul` on the wire; `choice` options are its `criteria`. */
function wireQuestions(questions: Readonly<Record<string, ClassifierQuestion>>) {
  return Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [
      id,
      q.type === 'choice'
        ? { type: 'choice', instructions: q.instructions, criteria: { ...q.options } }
        : q.type === 'bool'
          ? { type: 'noul', instructions: q.instructions, criteria: { true: q.yes, false: q.no } }
          : { type: 'score', instructions: q.instructions, criteria: [...q.criteria] },
    ]),
  );
}

const probability = z.number().min(0).max(1);
const wireAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string().min(1).max(200),
    probabilities: z.record(z.string(), probability),
    confidence: probability,
  }),
  z.object({ type: z.literal('noul'), noul: probability }),
  z.object({ type: z.literal('score'), score: z.number(), confidence: probability }),
]);
const outputSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  answers: z.record(z.string(), wireAnswerSchema),
  usage: z
    .object({ input_tokens: z.int().nonnegative(), output_tokens: z.int().nonnegative().optional() })
    .optional(),
});
const cloudflareSchema = z.object({ success: z.boolean().optional(), result: z.unknown() });

export interface SystemOneAnswer {
  readonly answers: Record<string, ClassifierAnswer>;
  /** The resolved model id the provider named, when it named one. */
  readonly model?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Validates a response body (untrusted) against the questions asked. */
export function parseSystemOneAnswer(
  provider: string,
  model: string,
  body: unknown,
  questions: Readonly<Record<string, ClassifierQuestion>>,
): Result<SystemOneAnswer> {
  const unwrapped = provider === CLOUDFLARE_PROVIDER ? cloudflareSchema.safeParse(body) : undefined;
  const parsed = outputSchema.safeParse(unwrapped?.success ? unwrapped.data.result : body);
  const params = { provider, model };
  if (!parsed.success)
    return err(
      ModelProviderError(params, { detail: `Unexpected System One answer: ${parsed.error.message}` }),
    );
  const answers: Record<string, ClassifierAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = parsed.data.answers[id];
    const expected = question.type === 'bool' ? 'noul' : question.type;
    if (!answer || answer.type !== expected)
      return err(ModelProviderError(params, { detail: `No ${expected} answer for ${id}.` }));
    if (answer.type === 'choice' && question.type === 'choice' && !(answer.choice in question.options))
      return err(ModelProviderError(params, { detail: `The answer for ${id} is not one of its options.` }));
    answers[id] =
      answer.type === 'noul'
        ? { type: 'bool', probability: answer.noul }
        : answer.type === 'choice'
          ? { ...answer, probabilities: { ...answer.probabilities } }
          : answer;
  }
  return ok({
    answers,
    ...(parsed.data.model ? { model: parsed.data.model } : {}),
    inputTokens: parsed.data.usage?.input_tokens ?? 0,
    outputTokens: parsed.data.usage?.output_tokens ?? 0,
  });
}
