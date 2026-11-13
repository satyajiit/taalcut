// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Foreground model calls inherit only the upload scope recorded for this tool invocation. */
import {
  CancelledError,
  err,
  EventLogStoreToken,
  ok,
  SettingsStoreToken,
  ValidationError,
  type AsyncResult,
  type BackgroundModels,
  type CommandToolContext,
  type Container,
} from '@taalcut/core';
import { foldEvents, fromCoreEventLog, type UploadScope } from '@taalcut/agent';
import {
  canFallBack,
  createBackgroundModels,
  NoModelForModule,
  type ModelRequest,
  type ModelResult,
} from '@taalcut/models';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-local-only-flag';

export type ApprovedToolContext = Pick<CommandToolContext, 'runId' | 'callId' | 'signal'>;

/** Reading the audit log avoids treating the current profile or a remembered run id as permission. */
export async function toolUploadApproval(
  container: Container,
  ctx: ApprovedToolContext,
): AsyncResult<UploadScope | undefined> {
  if (ctx.signal.aborted) return err(CancelledError());
  if (!ctx.runId || !container.has(EventLogStoreToken)) return ok(undefined);
  const events = await fromCoreEventLog(container.resolve(EventLogStoreToken)).read(ctx.runId);
  if (!events.ok) return events;
  const state = foldEvents(ctx.runId, events.value);
  const call = state.toolCalls[ctx.callId];
  if (!call || call.outcome) return ok(undefined);
  const approvals = Object.values(state.approvals).filter(
    (approval) =>
      ['consent', 'tool'].includes(approval.request.kind) &&
      approval.request.toolCallIds.includes(ctx.callId),
  );
  if (approvals.at(-1)?.status !== 'granted') return ok(undefined);
  const consent = approvals.findLast((approval) => approval.request.kind === 'consent');
  if (consent?.status !== 'granted' || consent.request.localOnly || consent.request.missingFiles?.length)
    return ok(undefined);
  return ok(consent.request.upload);
}

export function approvedToolModels(container: Container, ctx: ApprovedToolContext): BackgroundModels {
  return {
    async complete(request, signal) {
      const approval = await toolUploadApproval(container, ctx);
      if (!approval.ok) return approval;
      const modelSignal = signal ? AbortSignal.any([ctx.signal, signal]) : ctx.signal;
      return createBackgroundModels({
        client: container.resolve(ModelClientToken),
        selector: container.resolve(ModelProfilesToken),
        isLocalProvider: (provider) => container.resolve(ModelRuntimeToken).isLocalProvider(provider),
        settings: container.resolve(SettingsStoreToken),
        approvedUpload: approval.value ?? { modules: [], providers: [] },
      }).complete(localOnly(container) ? { ...request, placement: 'local' } : request, modelSignal);
    },
  };
}

/** Designer calls carry tools, so use the same consent rule with complete() and explicit fallback targets. */
export async function completeApprovedToolModel(
  container: Container,
  ctx: ApprovedToolContext,
  request: ModelRequest,
): AsyncResult<ModelResult> {
  const signal = request.signal ? AbortSignal.any([ctx.signal, request.signal]) : ctx.signal;
  if (signal.aborted) return err(CancelledError());
  const chain = container.resolve(ModelProfilesToken).resolve(request.module);
  if (!chain.ok) return chain;
  const runtime = container.resolve(ModelRuntimeToken);
  const choices = chain.value.choices.filter(
    (choice) => !localOnly(container) || runtime.isLocalProvider(choice.provider),
  );
  const cloud = [
    ...new Set(choices.filter((c) => !runtime.isLocalProvider(c.provider)).map((c) => c.provider)),
  ];
  const approval = await toolUploadApproval(container, ctx);
  if (!approval.ok) return approval;
  const allowed =
    approval.value?.modules.includes(request.module) &&
    cloud.every((provider) => approval.value!.providers.includes(provider));
  if (cloud.length && !allowed) {
    return err(
      ValidationError(
        { field: 'designer.consent' },
        { detail: 'Upload approval does not cover this model chain' },
      ),
    );
  }
  let last = NoModelForModule({ module: request.module });
  for (const target of choices) {
    if (signal.aborted) return err(CancelledError());
    const result = await container.resolve(ModelClientToken).complete({ ...request, target, signal });
    if (result.ok) return result;
    last = result.error;
    if (!canFallBack(last)) break;
  }
  return err(last);
}

function localOnly(container: Container): boolean {
  return container.has(LocalOnlyFlagToken) && container.resolve(LocalOnlyFlagToken).get();
}
