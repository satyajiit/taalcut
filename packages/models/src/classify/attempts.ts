// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One classification by one model, three ways: the on-device rules router (in process, free), TypeSafe and
 * Cloudflare over our own fetch (system-one.ts), and any other classifier pi-ai serves (OpenRouter's System
 * One, for one). Every attempt that reached a provider writes one CloudCall row under module `router`; the
 * rules router writes a local row, so Settings → Usage and the privacy panel see where routing ran.
 */
import type { AssistantMessage, ClassifierContext } from '@earendil-works/pi-ai';
import {
  err,
  newId,
  ok,
  type AsyncResult,
  type CloudCallRecord,
  type CloudCallSink,
  type TaalcutError,
} from '@taalcut/core';
import { recordCloudCall } from '../calls/cloud-call';
import { classifyFailure } from '../client/error-map';
import { createHttpMeter, type FetchFn, type HttpMeter } from '../client/http-meter';
import type { CredentialProvider, ResolvedCredential } from '../credentials/credential-provider';
import { ModelNotConfigured, ModelUnsuitable, UnknownModel } from '../errors';
import type { ModelChoice } from '../modules';
import { runtimeInternals, type ModelRuntime } from '../runtime/runtime';
import type { ClassifierAnswer, ClassifyRequest, ClassifyResult } from './classifier-types';
import { routerCostUsd, routerPrice } from './router-prices';
import { rulesClassify } from './rules-classifier';
import { parseSystemOneAnswer, systemOneCall } from './system-one';

export interface AttemptDeps {
  readonly runtime: ModelRuntime;
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSink;
  readonly fetch: FetchFn;
  readonly now: () => number;
}

type Row = Omit<CloudCallRecord, 'id' | 'module' | 'reasoning' | 'cacheWriteTokens' | 'cachedInputTokens'>;

function row(request: ClassifyRequest, fields: Row): CloudCallRecord {
  return {
    id: newId<'CloudCall'>(),
    module: 'router',
    reasoning: 'off',
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    ...fields,
    ...(request.trace?.runId ? { runId: request.trace.runId } : {}),
    ...(request.trace?.spanId ? { spanId: request.trace.spanId } : {}),
    ...(request.trace?.projectId ? { projectId: request.trace.projectId } : {}),
  };
}

/** The rules router: never a network call, never a cost. */
export async function rulesAttempt(
  deps: AttemptDeps,
  request: ClassifyRequest,
  choice: ModelChoice,
  index: number,
): AsyncResult<ClassifyResult> {
  const startedAt = deps.now();
  const answers = rulesClassify(request);
  const latencyMs = deps.now() - startedAt;
  const record = row(request, {
    provider: choice.provider,
    model: choice.model,
    local: true,
    startedAt,
    latencyMs,
    bytesSent: 0,
    bytesReceived: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    outcome: answers.ok ? 'ok' : 'error',
    ...(answers.ok ? {} : { errorCode: answers.error.code }),
    attempt: index + 1,
  });
  await recordCloudCall(deps.callLog, record);
  if (!answers.ok) return answers;
  return ok({
    ...base(record, choice.model),
    answers: answers.value,
    inputTokens: 0,
    costUsd: 0,
    local: true,
  });
}

/** TypeSafe or Cloudflare System One over fetch, priced from the router's own table. */
export async function systemOneAttempt(
  deps: AttemptDeps,
  request: ClassifyRequest,
  choice: ModelChoice,
  index: number,
): AsyncResult<ClassifyResult> {
  const params = { provider: choice.provider, model: choice.model };
  const credential = await credentialFor(deps, request, choice);
  if (!credential.ok) return credential;
  const call = systemOneCall({
    ...params,
    state: request.state,
    questions: request.questions,
    ...(credential.value.env ? { env: credential.value.env } : {}),
    ...(baseUrlOf(deps.runtime, choice.provider)
      ? { baseUrl: baseUrlOf(deps.runtime, choice.provider) }
      : {}),
  });
  if (!call.ok) return call;
  const secret = credential.value.secret ?? '';
  const meter = createHttpMeter(deps.fetch);
  const startedAt = deps.now();
  const outcome = await post(meter, call.value, secret, request.signal).then(
    async (response) => {
      if (!response.ok) return err(failure(params, meter, await response.text(), request, secret));
      return parseSystemOneAnswer(choice.provider, choice.model, await response.json(), request.questions);
    },
    (cause: unknown) => err(failure(params, meter, String(cause), request, secret)),
  );
  const latencyMs = deps.now() - startedAt;
  const inputTokens = outcome.ok ? outcome.value.inputTokens : 0;
  const costUsd = routerCostUsd(routerPrice(choice.provider, choice.model), inputTokens);
  const record = row(request, {
    ...params,
    local: false,
    startedAt,
    latencyMs,
    bytesSent: meter.bytesSent,
    bytesReceived: meter.bytesReceived,
    inputTokens,
    outputTokens: outcome.ok ? outcome.value.outputTokens : 0,
    costUsd,
    outcome: outcome.ok ? 'ok' : outcome.error.code === 'core.cancelled' ? 'cancelled' : 'error',
    ...(outcome.ok ? {} : { errorCode: outcome.error.code }),
    ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
    attempt: index + 1,
  });
  await recordCloudCall(deps.callLog, record);
  if (!outcome.ok) return outcome;
  return ok({
    ...base(record, outcome.value.model ?? choice.model),
    answers: outcome.value.answers,
    inputTokens,
    costUsd,
    local: false,
  });
}

/** Any other classifier pi-ai serves (its catalogue price, its wire format). */
export async function piAttempt(
  deps: AttemptDeps,
  request: ClassifyRequest,
  choice: ModelChoice,
  index: number,
): AsyncResult<ClassifyResult> {
  const { models, classifierModel } = runtimeInternals(deps.runtime);
  const params = { provider: choice.provider, model: choice.model };
  const model = classifierModel(choice.provider, choice.model);
  if (!model) {
    const otherKind = models.getAllModels(choice.provider).some((m) => m.id === choice.model);
    return err(
      otherKind ? ModelUnsuitable({ ...params, module: 'router', need: 'classifier' }) : UnknownModel(params),
    );
  }
  const credential = await credentialFor(deps, request, choice);
  if (!credential.ok) return credential;
  const secret = credential.value.secret ?? '';
  const meter = createHttpMeter(deps.fetch);
  const startedAt = deps.now();
  const result = await models.classify(model, toPiContext(request), {
    apiKey: secret,
    ...(credential.value.headers ? { headers: { ...credential.value.headers } } : {}),
    ...(credential.value.env ? { env: { ...credential.value.env } } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    fetch: meter.fetch,
    maxRetries: 0,
  });
  const latencyMs = deps.now() - startedAt;
  const error =
    result.stopReason !== 'stop'
      ? failure(params, meter, result.errorMessage ?? '', request, secret, result.stopReason)
      : undefined;
  const inputTokens = result.usage?.input ?? 0;
  const costUsd = result.usage?.cost.total ?? 0;
  const record = row(request, {
    ...params,
    local: false,
    startedAt,
    latencyMs,
    bytesSent: meter.bytesSent,
    bytesReceived: meter.bytesReceived,
    inputTokens,
    outputTokens: result.usage?.output ?? 0,
    costUsd,
    outcome: error ? (error.code === 'core.cancelled' ? 'cancelled' : 'error') : 'ok',
    ...(error ? { errorCode: error.code } : {}),
    ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
    attempt: index + 1,
  });
  await recordCloudCall(deps.callLog, record);
  if (error) return err(error);
  return ok({
    ...base(record, choice.model),
    answers: fromPiAnswers(result.answers),
    inputTokens,
    costUsd,
    local: false,
  });
}

function base(record: CloudCallRecord, model: string) {
  return { callId: record.id, provider: record.provider, model, latencyMs: record.latencyMs };
}

async function credentialFor(
  deps: AttemptDeps,
  request: ClassifyRequest,
  choice: ModelChoice,
): AsyncResult<ResolvedCredential> {
  const credential = await deps.credentials.get(
    choice.provider,
    request.signal ? { signal: request.signal } : {},
  );
  if (!credential.ok) return credential;
  if (!credential.value?.secret)
    return err(ModelNotConfigured({ provider: choice.provider, model: choice.model }));
  return ok(credential.value);
}

/** The provider's base URL as the runtime has it (a test build points it at a local server). */
function baseUrlOf(runtime: ModelRuntime, provider: string): string | undefined {
  return runtime.listModels(provider).find((model) => model.kind === 'classifier')?.baseUrl;
}

function post(
  meter: HttpMeter,
  call: { readonly url: string; readonly body: unknown },
  secret: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return meter.fetch(call.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(call.body),
    ...(signal ? { signal } : {}),
  });
}

function failure(
  params: { readonly provider: string; readonly model: string },
  meter: HttpMeter,
  text: string,
  request: ClassifyRequest,
  secret: string,
  stopReason: AssistantMessage['stopReason'] = 'error',
): TaalcutError {
  return classifyFailure({
    ...params,
    // classifyFailure reads only these two fields of pi-ai's message.
    message: { stopReason, errorMessage: text } as AssistantMessage,
    aborted: request.signal?.aborted === true,
    ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
    ...(meter.retryAfterMs !== undefined ? { retryAfterMs: meter.retryAfterMs } : {}),
    oauth: false,
    secrets: [secret],
  });
}

function toPiContext(request: ClassifyRequest): ClassifierContext {
  const questions: ClassifierContext['questions'] = {};
  for (const [id, q] of Object.entries(request.questions)) {
    questions[id] =
      q.type === 'choice'
        ? { type: 'choice', instructions: q.instructions, criteria: { ...q.options } }
        : q.type === 'bool'
          ? { type: 'bool', instructions: q.instructions, criteria: { true: q.yes, false: q.no } }
          : { type: 'score', instructions: q.instructions, criteria: [...q.criteria] };
  }
  return { state: structuredClone(request.state) as ClassifierContext['state'], questions };
}

function fromPiAnswers(answers: Record<string, unknown>): Record<string, ClassifierAnswer> {
  // pi-ai's answer shapes are Taalcut's; copying keeps pi-ai objects out of callers' hands.
  return structuredClone(answers) as Record<string, ClassifierAnswer>;
}
