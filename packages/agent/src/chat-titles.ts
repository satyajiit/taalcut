// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Chat titles: provisional titles (cleaned of canned prefixes, paths and URLs)
 * and 1–2 message adaptive AI titling via ModelClient.
 */
import { flat, isProceduralOpener, cleanTitle, isManagedTitle, TITLE_WORDS } from './chat-title-format';
export {
  provisionalTitle,
  isManagedTitle,
  isProvisionalTitle,
  cleanTitle,
  tidyTitle,
  PROVISIONAL_TITLE_LENGTH,
  TITLE_WORDS,
  MAX_CLEAN_TITLE_LENGTH,
} from './chat-title-format';
import type { ConversationId, ProjectId, RunId } from '@taalcut/core';
import { estimateUsd, type ModelClient, type ModuleId } from '@taalcut/models';
import { checkProjectCap, type CostDeps } from './costs';
import type { ConversationStore, StoredConversation, StoredMessagePart } from './ports';

export const TITLE_MAX_TOKENS = 128;
const EXCHANGE_LIMIT = 1_500;
const TITLE_MODULES: readonly ModuleId[] = ['agent', 'router'];

export const TITLE_PROMPT = [
  `You name chats in Taalcut, a video editing app.`,
  `Reply with a specific, natural 2 to 5 word title (at most ${TITLE_WORDS} words) in the language the user wrote in that names the concrete subject, place, trip, visual vibe, or specific edit (for example: "Jaipur Dawn Travel Reel", "Vietnam Lantern Boat Cut", "Tighten Hook & Color Grade").`,
  `Never name Taalcut's internal workflow or matching process (never use phrases like "Reference Matching", "Reel Matching", "Shot Matching", "Clip Matching", "Template Breakdown", "Inspired Video Edit", or "From My Footage").`,
  `Never use generic filler like "Make a video", "Video edit", "Like my trip reel", "New chat", or raw file paths or URLs.`,
  `Reply with the title only: no quotes, no markdown, no labels, and no trailing punctuation.`,
].join(' ');

const textOf = (parts: readonly StoredMessagePart[]) =>
  parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');

export interface Exchange {
  readonly user: string;
  readonly answer: string;
  readonly projectId?: ProjectId | null;
  readonly runId?: RunId;
}

export type ConversationTitler = (exchange: Exchange) => Promise<string | undefined>;

export function createConversationTitler(models: ModelClient, costs: CostDeps = {}): ConversationTitler {
  return async ({ user, answer, projectId, runId }) => {
    const content = `User: ${flat(user).slice(0, EXCHANGE_LIMIT)}\n\nTaalcut: ${flat(answer).slice(0, EXCHANGE_LIMIT)}`;
    const trace = { ...(projectId ? { projectId } : {}), ...(runId ? { runId } : {}) };
    for (const module of TITLE_MODULES) {
      if (!(await fitsCap(costs, module, projectId, TITLE_PROMPT.length + content.length))) continue;
      const result = await models.complete({
        module,
        system: TITLE_PROMPT,
        messages: [{ role: 'user', content }],
        reasoning: 'off',
        maxTokens: TITLE_MAX_TOKENS,
        ...(Object.keys(trace).length > 0 ? { trace } : {}),
      });
      if (result.ok) {
        const title = cleanTitle(result.value.text);
        if (title) return title;
      }
    }
    return undefined;
  };
}

async function fitsCap(
  costs: CostDeps,
  module: ModuleId,
  projectId: ProjectId | null | undefined,
  promptChars: number,
): Promise<boolean> {
  const price = costs.prices?.price(module);
  if (!projectId || !price || price.local) return true;
  const usd = estimateUsd(price, { inputTokens: Math.ceil(promptChars / 4), outputTokens: TITLE_MAX_TOKENS });
  return !(await checkProjectCap(costs, projectId, usd)).over;
}

type TitlingConversationStore = Omit<ConversationStore, 'rename'> & {
  rename(
    id: ConversationId,
    title: string,
    options?: { readonly preserveUpdatedAt?: boolean },
  ): ReturnType<ConversationStore['rename']>;
};

export interface ChatTitlingDeps {
  readonly conversations: TitlingConversationStore;
  readonly titles: ConversationTitler;
  readonly onChanged?: (conversation: { readonly id: ConversationId; readonly title: string }) => void;
  /** A generated title is stored, including when it already matched. Follow-up naming is best effort. */
  readonly onNamed?: (conversation: {
    readonly id: ConversationId;
    readonly title: string;
  }) => void | Promise<void>;
}

interface StoredSummaryExtras extends StoredConversation {
  readonly cards?: readonly { readonly runId?: RunId | null; readonly card?: unknown }[];
  readonly toolRuns?: readonly {
    readonly runId?: RunId | null;
    readonly tool?: string;
    readonly summary?: string;
    readonly label?: string;
  }[];
  readonly runs: readonly { readonly runId: RunId; readonly status?: string }[];
}

function extractFallbackSummary(stored: StoredSummaryExtras, afterRunId?: RunId): string {
  const parts: string[] = [];
  for (const entry of stored.cards ?? []) {
    if (afterRunId && (!entry.runId || entry.runId === afterRunId)) continue;
    const card = entry.card as Record<string, unknown> | null | undefined;
    if (!card || typeof card !== 'object') continue;
    if (card.type === 'approval' || card.type === 'consent' || card.type === 'costEstimate') continue;
    for (const key of ['title', 'summary', 'label', 'headline', 'name', 'description']) {
      if (typeof card[key] === 'string' && card[key].trim()) parts.push(card[key].trim());
    }
    if (Array.isArray(card.steps)) {
      const steps = card.steps
        .map((s) =>
          s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string'
            ? (s as { text: string }).text.trim()
            : '',
        )
        .filter(Boolean);
      if (steps.length > 0) parts.push(steps.join('; '));
    }
  }
  for (const toolRun of stored.toolRuns ?? []) {
    if (afterRunId && (!toolRun.runId || toolRun.runId === afterRunId)) continue;
    if (typeof toolRun.summary === 'string' && toolRun.summary.trim()) parts.push(toolRun.summary.trim());
    else if (typeof toolRun.label === 'string' && toolRun.label.trim()) parts.push(toolRun.label.trim());
    else if (typeof toolRun.tool === 'string' && toolRun.tool.trim()) {
      parts.push(toolRun.tool.replace(/[._-]+/gu, ' ').trim());
    }
  }
  return [...new Set(parts)].join('; ');
}

interface ConversationStage {
  readonly stage: 0 | 1 | 2;
  readonly lastAiTitle?: string;
  readonly proceduralStage1?: boolean;
}

export function createChatTitling(
  deps: ChatTitlingDeps,
): (conversationId: ConversationId, options?: { readonly paused?: boolean }) => Promise<void> {
  const stages = new Map<ConversationId, ConversationStage>();
  const inFlight = new Map<ConversationId, Promise<void>>();

  async function runForConversation(
    conversationId: ConversationId,
    options?: { readonly paused?: boolean },
  ): Promise<void> {
    const state = stages.get(conversationId) ?? { stage: 0 };
    if (state.stage >= 2) return;
    const storedResult = await deps.conversations.get(conversationId);
    if (!storedResult.ok) return;
    const stored = storedResult.value as StoredSummaryExtras;
    const { conversation, messages, runs } = stored;

    const userIndices: number[] = [];
    const userMessages: string[] = [];
    messages.forEach((m, idx) => {
      const text = m.role === 'user' ? textOf(m.parts).trim() : '';
      if (text) {
        userIndices.push(idx);
        userMessages.push(text);
      }
    });
    const firstUser = userMessages[0];
    if (!firstUser || !isManagedTitle(conversation.title, firstUser, state.lastAiTitle)) return;

    const assistantMessages = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => textOf(m.parts).trim())
      .filter(Boolean);
    const fallbackSummary = extractFallbackSummary(stored);
    const assistantText = assistantMessages.join('\n\n');
    const answer = assistantText || fallbackSummary;
    if (!answer.trim()) return;

    const latestRun = runs.at(-1);
    const isPaused = Boolean(
      options?.paused || (latestRun?.status === 'paused' && runs.every((r) => r.status === 'paused')),
    );
    const proceduralOnly = !fallbackSummary && isProceduralOpener(assistantText);
    if (isPaused && (state.stage >= 1 || proceduralOnly)) return;

    const firstRunId = runs[0]?.runId;
    const secondUserIdx = userIndices[1];
    const hasAfterSecondUser =
      secondUserIdx !== undefined &&
      messages
        .slice(secondUserIdx + 1)
        .some((m) => m.role === 'assistant' && Boolean(textOf(m.parts).trim()));
    const hasLaterRunAnswer =
      firstRunId !== undefined &&
      (messages.some(
        (m) =>
          m.role === 'assistant' &&
          m.runId !== null &&
          m.runId !== firstRunId &&
          Boolean(textOf(m.parts).trim()),
      ) ||
        Boolean(extractFallbackSummary(stored, firstRunId)));
    const hasSecondTurnResponse =
      userMessages.length >= 2 && (hasAfterSecondUser || hasLaterRunAnswer || assistantMessages.length >= 2);
    if (state.stage === 1 && !hasSecondTurnResponse && !(state.proceduralStage1 && !proceduralOnly)) return;

    const targetStage: 1 | 2 = state.stage === 1 || hasSecondTurnResponse ? 2 : 1;
    const traceRunId = latestRun?.runId ?? firstRunId;
    const title = await deps.titles({
      user: userMessages.slice(0, 2).join('\n\n'),
      answer,
      ...(conversation.projectId ? { projectId: conversation.projectId } : {}),
      ...(traceRunId ? { runId: traceRunId } : {}),
    });
    if (!title) return;
    if (title !== conversation.title) {
      const renamed = await deps.conversations.rename(conversationId, title, { preserveUpdatedAt: true });
      if (!renamed.ok) return;
      deps.onChanged?.({ id: conversationId, title });
    }
    stages.set(conversationId, {
      stage: targetStage,
      lastAiTitle: title,
      ...(targetStage === 1 && proceduralOnly ? { proceduralStage1: true } : {}),
    });
    await deps.onNamed?.({ id: conversationId, title });
  }

  return async (conversationId, options) => {
    const prev = inFlight.get(conversationId) ?? Promise.resolve();
    const next = prev
      .then(() => runForConversation(conversationId, options))
      .catch(() => {
        // Titling is best effort; keep chat usable and report failure without logging message content.
        console.warn('[chat-titles] Could not update the conversation title.');
      });
    inFlight.set(conversationId, next);
    await next;
    if (inFlight.get(conversationId) === next) inFlight.delete(conversationId);
  };
}
