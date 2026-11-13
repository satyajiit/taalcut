// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a run's run.started tells the chat events after it: the conversation, the effort, the project, the
 * message's reference pointers (agent.runStarted carries them, so the live message shows its chips before a
 * reload) and, for a run an external agent drives over MCP, who asked (the requester line on the run's consent
 * and project-cap cards, as on its approval cards).
 */
import {
  cardRequesterSchema,
  type CardRequester,
  type ChatEffort,
  type ConversationId,
  type ReasoningLevel,
  type ReferencePointer,
  type RunId,
} from '@taalcut/core';
import type { EventPayloads } from './events';

/** agent.runStarted's limit (core's agentRunStartedSchema). */
const MAX_POINTERS = 10;

type Started = EventPayloads['run.started'];

/** The external agent's session as a card's requester; none when the logged session doesn't parse. */
function requesterOf(external: Started['external']): CardRequester | undefined {
  if (!external) return undefined;
  const parsed = cardRequesterSchema.safeParse({
    kind: 'mcp',
    sessionId: external.sessionId,
    name: external.name.slice(0, 60),
  });
  return parsed.success ? parsed.data : undefined;
}

export class RunStart {
  conversationId = '' as ConversationId;
  projectId: string | null = null;
  /** Set for a run an external agent drives. */
  requester: CardRequester | undefined;
  private effort: ChatEffort | undefined;
  private reasoning: ReasoningLevel | undefined;
  private pointers: ReferencePointer[] | undefined;

  read(started: Started): void {
    this.conversationId = started.conversationId as ConversationId;
    this.effort = started.effort;
    this.reasoning = started.reasoning;
    this.projectId = started.projectId ?? null;
    this.pointers = started.pointers?.length ? started.pointers.slice(0, MAX_POINTERS) : undefined;
    this.requester = requesterOf(started.external);
  }

  /** agent.runStarted's payload: on run.started and on every run.resumed. */
  payload(runId: RunId) {
    return {
      runId,
      conversationId: this.conversationId,
      ...(this.effort ? { effort: this.effort } : {}),
      ...(this.reasoning ? { reasoning: this.reasoning } : {}),
      ...(this.pointers ? { pointers: this.pointers } : {}),
    };
  }
}
