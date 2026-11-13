// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a user message carries besides its words (P3-V15, EDT1-CTX): the run's opening choice, the selection chips,
 * what its words pointed at and the editor as the user saw it from the docked chat. The chat service sends them
 * with the run, links the conversation to a project through them, and gives them back to the message in history.
 */
import type { ConversationId, EditorContext, ProjectId, SelectionChip, TimelineId } from '@taalcut/core';
import type { StartRequest } from './agent-types';
import type { ChatHistoryEvent, UserMessageEvent } from './chat-types';
import { commentIds } from './comments/chat-comments';
import type { AgentEvent } from './events';

/** Links a conversation to the project its chips (or the editor's timeline) belong to; null when none does. */
export type LinkProject = (
  conversationId: ConversationId,
  selections: readonly SelectionChip[],
  /** EDT1: the timeline the editor's dock shows, which wins over the chips'. */
  timelineId?: TimelineId,
) => Promise<ProjectId | null>;

export interface MessageExtras {
  readonly start?: StartRequest['start'];
  readonly selections?: SelectionChip[];
  readonly editorContext?: EditorContext;
}

/** The extras a sent message keeps, for its user.message and the run it starts: only what it has. */
export function messageExtras(sent: {
  readonly start?: StartRequest['start'] | undefined;
  readonly selections?: readonly SelectionChip[] | undefined;
  readonly editorContext?: EditorContext | undefined;
}): MessageExtras {
  const { start, selections, editorContext } = sent;
  return {
    ...(start ? { start } : {}),
    ...(selections?.length ? { selections: [...selections] } : {}),
    ...(editorContext ? { editorContext } : {}),
  };
}

/**
 * The project a new conversation joins from what its first message carries: the chips' project, or (EDT1) the
 * editor's timeline's, as a chip naming it would. Undefined when it carries neither or nothing links it.
 */
export async function linkedProject(
  link: LinkProject | undefined,
  conversationId: ConversationId,
  extras: MessageExtras,
): Promise<ProjectId | undefined> {
  const { selections, editorContext } = extras;
  if (!link || (!selections?.length && !editorContext)) return undefined;
  return (await link(conversationId, selections ?? [], editorContext?.timelineId)) ?? undefined;
}

/**
 * The user message a run started from gets the run's opening choice, selections and what its words pointed at
 * (P3-V15) back, and (EDT1-CMT) the comments it sent (history only).
 */
export function withExtras(segments: { events: ChatHistoryEvent[] }[], first: AgentEvent): void {
  if (first.type !== 'run.started') return;
  const { start, selections, pointers, message, comments } = first.payload;
  const editorContext = first.payload.editor?.context;
  if (!start && !selections && !pointers && !editorContext && !comments) return;
  const match = segments
    .flatMap((s) => s.events)
    .filter(
      (e): e is UserMessageEvent =>
        e.type === 'user.message' && e.payload.text === message && e.at <= first.at,
    )
    .at(-1);
  if (!match) return;
  Object.assign(match, {
    payload: {
      ...match.payload,
      ...(start ? { start } : {}),
      ...(selections ? { selections } : {}),
      ...(pointers ? { pointers } : {}),
      ...(editorContext ? { editorContext } : {}),
      ...commentIds(comments), // EDT1-CMT
    },
  });
}
