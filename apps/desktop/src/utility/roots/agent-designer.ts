// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-DSN in the agent process: the Designer outside a chat run, for tpl's DesignOverlay (the template's reading
 * designing its graphics, the make's frame checks redesigning one). It runs on the chat's model (the agent module's
 * chain, through this process's ModelClient: Local only refuses a cloud model before anything is sent), with the
 * workspace tools as the chat's Designer has them (agent-workspace-tools.ts), their commands on this process's bus
 * as the agent's, and the agent's artifact store for the stills. None where the Designer can't run.
 *
 * Pictures and consent: the make's frame checks draw over the person's footage, and nobody is there to ask mid-make,
 * so a cloud model gets those frames as pictures only under the person's standing upload consent for the agent's
 * module (the "Always allow" a consent card grants, covering every cloud provider its chain may call now). Without
 * it, the Designer reads the checks in words. A template's reading sends the reel's own frames, which never ask.
 */
import {
  CommandBusToken,
  agentTurnGroup,
  err,
  newId,
  NotImplementedError,
  ok,
  ProjectBudgetStoreToken,
  ValidationError,
  type AsyncResult,
  type Container,
  type ReasoningLevel,
  type ProjectId,
  type RunId,
  type CommandToolContext,
} from '@taalcut/core';
import type { UploadConsent } from '@taalcut/agent';
import type { AssistantChatMessage, ChatMessage, ModelClient } from '@taalcut/models';
import {
  templateDesigner,
  type DesignerMessage,
  type DesignerModel,
  type DesignOverlay,
} from '@taalcut/render';
import {
  LibraryPortsToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
} from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-local-only-flag';
import { ConsentStoreToken } from './agent-consent-token';
import { canDesign, workspaceToolDepsOf } from './agent-workspace-tools';
import { moduleSeesImages } from './model-windows';
import { completeApprovedToolModel, toolUploadApproval } from './agent-tool-models';

const ACTOR = 'agent:designer';

const isAssistant = (value: unknown): value is AssistantChatMessage =>
  typeof value === 'object' && value !== null && (value as { role?: unknown }).role === 'assistant';

/** The loop's messages as the model client takes them. */
function chatMessages(messages: readonly DesignerMessage[]): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    if (message.role === 'user') return { role: 'user', content: [...message.content] };
    if (message.role === 'tool')
      return {
        role: 'tool',
        toolCallId: message.callId,
        toolName: message.name,
        content: [...message.content],
        isError: message.isError,
      };
    if (isAssistant(message.native)) return message.native;
    const [provider = '', ...rest] = (message.model ?? '').split('/');
    return {
      role: 'assistant',
      parts: [
        ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
        ...message.calls.map((call) => ({
          type: 'tool_call' as const,
          call: { ...call, arguments: { ...call.arguments } },
        })),
      ],
      provider,
      model: rest.join('/'),
    };
  });
}

/** The chat's model as the Designer loop's. */
function chatDesigner(
  client: Pick<ModelClient, 'complete'>,
  seesImages: boolean,
  reasoning?: ReasoningLevel,
  context?: {
    readonly projectId?: ProjectId;
    readonly runId?: RunId;
    readonly beforeCall: () => AsyncResult<void>;
    readonly reportUsage?: CommandToolContext['reportUsage'];
  },
): DesignerModel {
  return {
    seesImages,
    async turn(request, signal) {
      if (context) {
        const allowed = await context.beforeCall();
        if (!allowed.ok) return allowed;
      }
      const answer = await client.complete({
        module: 'agent',
        system: request.system,
        messages: chatMessages(request.messages),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.schema,
        })),
        maxTokens: request.maxTokens,
        ...(reasoning ? { reasoning } : {}),
        trace: {
          spanId: newId<'Span'>(),
          ...(context?.projectId ? { projectId: context.projectId } : {}),
          ...(context?.runId ? { runId: context.runId } : {}),
        },
        ...(signal ? { signal } : {}),
      });
      if (!answer.ok) return answer;
      context?.reportUsage?.({ usd: answer.value.usage.costUsd });
      const { text, toolCalls, provider, model, local, message } = answer.value;
      return ok({ text, calls: toolCalls, model: `${provider}/${model}`, local, native: message });
    },
  };
}

/** What the Designer draws over: the person's footage (the make), or a reel's own frames (a template's reading). */
export type DesignerFrames = 'footage' | 'reel';

export interface DesignerPictureFacts {
  readonly frames: DesignerFrames;
  /** Every model in the agent module's chain takes images. */
  readonly sees: boolean;
  /** Local only is on: no cloud model is called. */
  readonly localOnly: boolean;
  /** The cloud providers the agent module's chain may call now (none: it runs on this Mac). */
  readonly cloudProviders: readonly string[];
  /** The person's standing upload consent for the agent module, read when the job starts. */
  readonly consent: () => Promise<UploadConsent | undefined>;
  /** The current foreground tool's granted upload scope, if any. */
  readonly approvedProviders?: readonly string[];
}

/**
 * Whether the Designer's stills and frames go to its model as pictures. On this Mac, always; a reel's frames, always
 * (sending them is part of making a template); the person's footage to a cloud model, only under a standing consent
 * that covers every provider the chain may call (a provider added later needs a new one, as for any upload).
 */
export async function designerSeesPictures(facts: DesignerPictureFacts): Promise<boolean> {
  if (!facts.sees) return false;
  if (facts.localOnly || facts.cloudProviders.length === 0 || facts.frames === 'reel') return true;
  if (facts.cloudProviders.every((provider) => facts.approvedProviders?.includes(provider))) return true;
  const consent = await facts.consent();
  return (
    consent !== undefined && facts.cloudProviders.every((provider) => consent.providers.includes(provider))
  );
}

/** The cloud providers the agent module's chain may call now; without profiles to read, an unknown one (no consent covers it). */
export function agentCloudProviders(container: Container): readonly string[] {
  if (!container.has(ModelProfilesToken) || !container.has(ModelRuntimeToken)) return ['unknown'];
  const runtime = container.resolve(ModelRuntimeToken);
  return container
    .resolve(ModelProfilesToken)
    .effective('agent')
    .chain.filter((choice) => !runtime.isLocalProvider(choice.provider))
    .map((choice) => choice.provider);
}

/** The agent module's active thinking level from its override or profile chain. */
function agentReasoning(container: Container): ReasoningLevel | undefined {
  if (!container.has(ModelProfilesToken)) return undefined;
  const profiles = container.resolve(ModelProfilesToken);
  return profiles.state().overrides.agent?.reasoning ?? profiles.effective('agent').chain[0]?.reasoning;
}

/**
 * tpl's DesignOverlay by the Designer, or undefined where it can't run (no workspace store, comments or models).
 * `frames`: what it draws over, for the pictures rule above (`footage` unless said).
 */
export function templateDesignerOf(
  container: Container,
  options: {
    readonly frames?: DesignerFrames;
    readonly projectId?: ProjectId;
    readonly runId?: RunId;
    readonly toolContext?: CommandToolContext;
  } = {},
): DesignOverlay | undefined {
  if (!canDesign(container) || !container.has(ModelClientToken) || !container.has(LibraryPortsToken))
    return undefined;
  const seeing = moduleSeesImages(container);
  return async (job, signal) => {
    if (!container.has(CommandBusToken))
      return err(NotImplementedError({ feature: 'designer' }, { detail: 'No command bus' }));
    const bus = container.resolve(CommandBusToken);
    const approval = options.toolContext
      ? await toolUploadApproval(container, options.toolContext)
      : undefined;
    if (approval && !approval.ok) return approval;
    // Read for each job: a consent taken back, or a cloud model added to the chain, counts from the next one.
    const pictures = await designerSeesPictures({
      frames: options.frames ?? 'footage',
      sees: seeing('agent'),
      localOnly: container.has(LocalOnlyFlagToken) && container.resolve(LocalOnlyFlagToken).get(),
      cloudProviders: agentCloudProviders(container),
      consent: async () =>
        container.has(ConsentStoreToken) ? container.resolve(ConsentStoreToken).get('agent') : undefined,
      ...(approval?.value?.modules.includes('agent') ? { approvedProviders: approval.value.providers } : {}),
    });
    const design = templateDesigner({
      model: chatDesigner(
        options.toolContext
          ? { complete: (request) => completeApprovedToolModel(container, options.toolContext!, request) }
          : container.resolve(ModelClientToken),
        pictures,
        agentReasoning(container),
        {
          ...(options.projectId ? { projectId: options.projectId } : {}),
          ...(options.runId ? { runId: options.runId } : {}),
          ...(options.toolContext ? { reportUsage: options.toolContext.reportUsage } : {}),
          beforeCall: async () => {
            if (!options.projectId || !container.has(ProjectBudgetStoreToken)) return ok(undefined);
            const budget = await container.resolve(ProjectBudgetStoreToken).get(options.projectId);
            if (!budget.ok) return budget;
            const { cap, spent } = budget.value;
            return cap && cap.currency === spent.currency && spent.micros >= cap.micros
              ? err(ValidationError({ field: 'designer.budget' }, { detail: 'Project budget reached' }))
              : ok(undefined);
          },
        },
      ),
      workspace: workspaceToolDepsOf(container),
      dispatch: async (command, payload) => {
        const done = await bus.dispatch(
          command,
          payload,
          { source: 'agent', actor: options.runId ? `agent:${options.runId}` : ACTOR },
          options.runId ? { group: agentTurnGroup(options.runId) } : {},
        );
        return done.ok ? ok(done.value.result) : done;
      },
      artifacts: container.resolve(LibraryPortsToken).artifacts,
    });
    return design(job, signal);
  };
}
