// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One call to one model: credential → pi-ai stream → Taalcut events, usage,
 * cost and a cloud-call record. The fallback chain in model-client.ts decides
 * what happens after a failure.
 */
import {
  clampThinkingLevel,
  type Api,
  type AssistantMessage,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import {
  err,
  newId,
  ok,
  type CloudCallId,
  type CloudCallSink,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { recordCloudCall } from '../calls/cloud-call';
import type { CredentialProvider, ResolvedCredential } from '../credentials/credential-provider';
import {
  LocalRuntimeUnavailable,
  ModelNotConfigured,
  ModelProviderUnavailable,
  ModelUnsuitable,
  UnknownModel,
} from '../errors';
import { LOCAL_RUNTIME_PROVIDER } from '../local-runtime/types';
import { MODULES, type ModelChoice, type ReasoningLevel } from '../modules';
import type { RuntimeInternals } from '../runtime/runtime';
import { enforceChatGPTPlan, isChatGPTPlan, isPlanBilled, servingProvider } from './chatgpt-plan';
import { planModelFor, planReasoning } from './chatgpt-plan-models';
import { classifyFailure } from './error-map';
import { createHttpMeter, type FetchFn } from './http-meter';
import { mendLeakedMarkup } from './leaked-markup';
import { fromPiAssistant, fromPiToolCall, toPiContext } from './messages';
import type { Emit } from './model-stream';
import { DEFAULT_STALL_MS, watchStall } from './stall-watch';
import { reasoningForEffort } from './thinking';
import { toPiTools } from './tools';
import type { CallUsage, ModelRequest, ModelResult, StopReason } from './types';

export interface AttemptDeps {
  readonly internals: RuntimeInternals;
  readonly isLocal: (provider: string) => boolean;
  readonly credentials: CredentialProvider;
  readonly callLog: CloudCallSink;
  readonly fetch: FetchFn;
  readonly now: () => number;
  readonly retry: {
    readonly maxRetries?: number;
    readonly maxRetryDelayMs?: number;
    readonly timeoutMs?: number;
  };
  /** FIX-RUN: a stream quiet this long (no byte, no event) is aborted as a dropped connection. Default 90 s. */
  readonly stallMs?: number;
  /** FIX-CMT: the longest an embedded-runtime call may take, start to end. Default LOCAL_CALL_DEADLINE_MS. */
  readonly localDeadlineMs?: number;
}

/**
 * FIX-CMT: the most an embedded-runtime answer may run to when the request sets no maxTokens: the MLX server's own
 * default, so an MLX call is as before, and a llama-server call (which has none) stops there instead of at the
 * window. The longest live 9B turn in 4,763 recorded edit-eval turns was 533 tokens.
 */
export const LOCAL_MAX_OUTPUT_TOKENS = 4_096;
/** FIX-CMT: an embedded-runtime call still going this long after it started is aborted, however much it streams. */
export const LOCAL_CALL_DEADLINE_MS = 15 * 60_000;

export interface AttemptOutcome {
  readonly result: Result<ModelResult>;
  /** Text, reasoning or a tool call reached the consumer, so switching models now would duplicate output. */
  readonly producedOutput: boolean;
  /** The model sent when the call ran on the ChatGPT plan's sign-in (planModelFor), for the plan's own retry. */
  readonly planModel?: string;
}

/** Keyless local servers still need a non-empty key for the OpenAI SDK; they ignore it. */
const LOCAL_PLACEHOLDER_KEY = 'local-no-key';

export async function runAttempt(
  deps: AttemptDeps,
  request: ModelRequest,
  choice: ModelChoice,
  attempt: number,
  emit: Emit,
): Promise<AttemptOutcome> {
  const failed = (error: TaalcutError): AttemptOutcome => ({ result: err(error), producedOutput: false });
  const params = { provider: choice.provider, model: choice.model };
  const served = servingProvider(choice.provider);

  const found = deps.internals.chatModel(served.provider, choice.model);
  if (!found) {
    // The embedded runtime registers its endpoint only while it runs (D16).
    if (choice.provider === LOCAL_RUNTIME_PROVIDER) {
      const running = deps.internals.models.getProvider(LOCAL_RUNTIME_PROVIDER) !== undefined;
      return failed(LocalRuntimeUnavailable({ state: running ? 'model_not_installed' : 'not_running' }));
    }
    // An image or classifier model in a chat chain is a profile mistake, not a missing model.
    const otherKind = deps.internals.models.getAllModels(served.provider).some((m) => m.id === choice.model);
    return failed(
      otherKind ? ModelUnsuitable({ ...params, module: request.module, need: 'chat' }) : UnknownModel(params),
    );
  }
  if (MODULES[request.module].needs.includes('image-input') && !found.input.includes('image')) {
    return failed(ModelUnsuitable({ ...params, module: request.module, need: 'image-input' }));
  }

  const local = deps.isLocal(choice.provider);
  const credentialResult = await deps.credentials.get(
    served.provider,
    request.signal ? { signal: request.signal } : {},
  );
  if (!credentialResult.ok) return failed(credentialResult.error);
  // A pick on the ChatGPT plan never runs on an API key that happens to be stored for the same provider.
  const credential =
    served.planOnly && !isPlanBilled(credentialResult.value) ? undefined : credentialResult.value;
  if (!credential && !local) return failed(ModelNotConfigured(params));

  // The ChatGPT plan's sign-in runs only the plan's models: the pick's role's model goes out instead (UX3-AGT).
  const chatGPTPlan = isChatGPTPlan(served.provider, credential);
  const sent = chatGPTPlan ? planModelFor(choice.model) : choice.model;
  const runs = sent === choice.model ? found : deps.internals.chatModel(served.provider, sent);
  if (!runs) return failed(UnknownModel({ provider: choice.provider, model: sent }));
  const plan = chatGPTPlan ? { planModel: sent } : {};
  const ran: ModelChoice = { ...choice, model: sent };

  const model: Model<Api> = credential?.baseUrl ? { ...runs, baseUrl: credential.baseUrl } : runs;
  const endpointKey = local ? deps.internals.endpointKey(choice.provider) : undefined;
  // FIX-CMT: the embedded runtime's answers have a cap and a deadline, and never run with thinking on.
  const embedded = choice.provider === LOCAL_RUNTIME_PROVIDER;
  const requested: ReasoningLevel = request.reasoning ?? choice.reasoning ?? 'off';
  const level: ReasoningLevel = embedded
    ? 'off'
    : request.effort
      ? reasoningForEffort(model, request.effort)
      : (clampThinkingLevel(model, requested) as ReasoningLevel);
  // ChatGPT's levels for its plan's models start at low: the API's none (and minimal) aren't among them.
  const reasoning = chatGPTPlan && model.reasoning ? planReasoning(level) : level;
  const callId = newId<'CloudCall'>();
  const startedAt = deps.now();
  const meter = createHttpMeter(deps.fetch);
  const watch = watchStall({
    stallMs: deps.stallMs ?? DEFAULT_STALL_MS,
    ...(request.signal ? { signal: request.signal } : {}),
    received: () => meter.bytesReceived,
    ...(embedded ? { deadlineMs: deps.localDeadlineMs ?? LOCAL_CALL_DEADLINE_MS } : {}),
  });
  const capped =
    embedded && request.maxTokens === undefined
      ? {
          ...request,
          maxTokens: Math.min(LOCAL_MAX_OUTPUT_TOKENS, model.maxTokens > 0 ? model.maxTokens : Infinity),
        }
      : request;
  let payloadBytes = 0;
  let producedOutput = false;

  emit({
    type: 'start',
    callId,
    module: request.module,
    provider: choice.provider,
    model: sent,
    reasoning,
    local,
  });

  const context = toPiContext(request.system, request.messages, startedAt);
  if (request.tools?.length) context.tools = toPiTools(request.tools, embedded);
  const stream = deps.internals.models.streamSimple(model, context, {
    ...streamOptions(
      { ...capped, signal: watch.signal },
      credential,
      local,
      endpointKey,
      reasoning,
      deps.retry,
    ),
    fetch: meter.fetch,
    onPayload: (payload) => {
      const body = chatGPTPlan ? enforceChatGPTPlan(payload) : payload;
      payloadBytes = Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8');
      return chatGPTPlan ? body : undefined;
    },
  });

  for await (const event of stream) {
    watch.alive();
    if (event.type === 'text_delta') {
      producedOutput = true;
      emit({ type: 'text_delta', index: event.contentIndex, delta: event.delta });
    } else if (event.type === 'thinking_delta') {
      producedOutput = true;
      emit({ type: 'reasoning_delta', index: event.contentIndex, delta: event.delta });
    } else if (event.type === 'toolcall_end') {
      producedOutput = true;
      emit({ type: 'tool_call', index: event.contentIndex, call: fromPiToolCall(event.toolCall) });
    }
  }
  const final = await stream.result();
  watch.stop();
  // A plan pays for the call (UX3-AGT): it costs nothing per token, so no budget counts it.
  const usage = toCallUsage(final, isPlanBilled(credential));
  const latencyMs = deps.now() - startedAt;

  const failedRun = final.stopReason === 'error' || final.stopReason === 'aborted';
  const classified = failedRun
    ? classifyFailure({
        provider: choice.provider,
        model: sent,
        message: final,
        aborted: request.signal?.aborted === true,
        ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
        ...(meter.retryAfterMs !== undefined ? { retryAfterMs: meter.retryAfterMs } : {}),
        ...(meter.resetAt !== undefined ? { resetAt: meter.resetAt } : {}),
        now: deps.now(),
        contextWindow: model.contextWindow,
        oauth: credential?.kind === 'oauth_access',
        secrets: [credential?.secret, endpointKey].filter((s): s is string => s !== undefined),
      })
    : undefined;
  // Said as ChatGPT's refusal, not as OpenAI lacking the model (the API has it; the plan doesn't take it).
  const error = watch.overDeadline
    ? ModelProviderUnavailable(params, {
        detail: `timed out: the answer ran past ${deps.localDeadlineMs ?? LOCAL_CALL_DEADLINE_MS} ms`,
      })
    : watch.stalled
      ? ModelProviderUnavailable(params, {
          detail: `stalled: no data for ${deps.stallMs ?? DEFAULT_STALL_MS} ms`,
        })
      : chatGPTPlan && classified?.code === UnknownModel.code
        ? UnknownModel(
            { provider: choice.provider, model: sent, via: 'chatgpt' },
            classified.detail ? { detail: classified.detail } : {},
          )
        : classified;
  if (error && meter.lastStatus === 401) deps.credentials.invalidate?.(served.provider);

  await recordCloudCall(deps.callLog, {
    id: callId,
    module: request.module,
    provider: choice.provider,
    model: sent,
    reasoning,
    local,
    startedAt,
    latencyMs,
    bytesSent: meter.bytesSent || payloadBytes,
    bytesReceived: meter.bytesReceived,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: usage.costUsd,
    outcome: error ? (error.code === 'core.cancelled' ? 'cancelled' : 'error') : 'ok',
    ...(error ? { errorCode: error.code } : {}),
    ...(meter.lastStatus !== undefined ? { httpStatus: meter.lastStatus } : {}),
    attempt,
    ...(request.trace?.runId ? { runId: request.trace.runId } : {}),
    ...(request.trace?.spanId ? { spanId: request.trace.spanId } : {}),
    ...(request.trace?.projectId ? { projectId: request.trace.projectId } : {}),
  });

  if (error) return { result: err(error), producedOutput, ...plan };
  emit({ type: 'usage', callId, usage });
  return {
    result: ok({
      ...toResult(callId, request, ran, reasoning, final, usage, latencyMs, local),
      ...(isPlanBilled(credential) ? { planBilled: true } : {}),
    }),
    producedOutput,
    ...plan,
  };
}

function streamOptions(
  request: ModelRequest,
  credential: ResolvedCredential | undefined,
  local: boolean,
  endpointKey: string | undefined,
  reasoning: ReasoningLevel,
  retry: AttemptDeps['retry'],
): SimpleStreamOptions {
  const apiKey = credential?.secret ?? endpointKey ?? (local ? LOCAL_PLACEHOLDER_KEY : undefined);
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(credential?.headers ? { headers: { ...credential.headers } } : {}),
    ...(credential?.env ? { env: { ...credential.env } } : {}),
    ...(reasoning !== 'off' ? { reasoning } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(retry.maxRetries !== undefined ? { maxRetries: retry.maxRetries } : {}),
    ...(retry.maxRetryDelayMs !== undefined ? { maxRetryDelayMs: retry.maxRetryDelayMs } : {}),
    ...(retry.timeoutMs !== undefined ? { timeoutMs: retry.timeoutMs } : {}),
  };
}

function toCallUsage(message: AssistantMessage, planBilled: boolean): CallUsage {
  const u = message.usage;
  return {
    inputTokens: u.input,
    outputTokens: u.output,
    cachedInputTokens: u.cacheRead,
    cacheWriteTokens: u.cacheWrite,
    ...(u.reasoning !== undefined ? { reasoningTokens: u.reasoning } : {}),
    totalTokens: u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite,
    costUsd: planBilled ? 0 : u.cost.total,
  };
}

function toStopReason(reason: AssistantMessage['stopReason']): StopReason {
  if (reason === 'length') return 'length';
  if (reason === 'toolUse') return 'tool_use';
  return 'stop';
}

function toResult(
  callId: CloudCallId,
  request: ModelRequest,
  choice: ModelChoice,
  reasoning: ReasoningLevel,
  final: AssistantMessage,
  usage: CallUsage,
  latencyMs: number,
  local: boolean,
): ModelResult {
  // AGT1: tool-call markup a local server left in the text joins its call (leaked-markup.ts).
  const message = local ? mendLeakedMarkup(fromPiAssistant(final)) : fromPiAssistant(final);
  const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
  const toolCalls = message.parts.flatMap((p) => (p.type === 'tool_call' ? [p.call] : []));
  return {
    callId,
    module: request.module,
    provider: choice.provider,
    model: choice.model,
    reasoning,
    message,
    text,
    toolCalls,
    stopReason: toStopReason(final.stopReason),
    usage,
    latencyMs,
    local,
  };
}
