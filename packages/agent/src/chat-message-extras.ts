// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a user message carries besides its words (P3-V15, EDT1-CTX): the run's opening choice, the selection chips,
 * what its words pointed at, the editor as the user saw it from the docked chat and (CVR1) the cover asked for in
 * the editor's cover panel. The chat service sends them with the run, links the conversation to a project through
 * them, and gives them back to the message in history.
 */
import type {
  ConversationId,
  CoverRequest,
  EditorContext,
  PostCaptionRequest,
  ProjectId,
  SelectionChip,
  TimelineId,
} from '@taalcut/core';
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
  readonly cover?: CoverRequest;
  /** CAP1: the post caption asked for in the editor's caption panel. */
  readonly postCaption?: PostCaptionRequest;
}

/** The extras a sent message keeps, for its user.message and the run it starts: only what it has. */
export function messageExtras(sent: {
  readonly start?: StartRequest['start'] | undefined;
  readonly selections?: readonly SelectionChip[] | undefined;
  readonly editorContext?: EditorContext | undefined;
  readonly cover?: CoverRequest | undefined;
  readonly postCaption?: PostCaptionRequest | undefined;
}): MessageExtras {
  const { start, selections, editorContext, cover } = sent;
  return {
    ...(start ? { start } : {}),
    ...(selections?.length ? { selections: [...selections] } : {}),
    ...(editorContext ? { editorContext } : {}),
    // CVR1: a cover is asked for from the editor, so it goes only with the editor it was asked in.
    ...(editorContext && cover ? { cover } : {}),
    // CAP1: so is a post caption.
    ...(editorContext && sent.postCaption ? { postCaption: sent.postCaption } : {}),
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
 * (P3-V15) back, (EDT1-CMT) the comments it sent and (CVR1) the cover it asked for (history only).
 */
export function withExtras(segments: { events: ChatHistoryEvent[] }[], first: AgentEvent): void {
  if (first.type !== 'run.started') return;
  const { start, selections, pointers, message, comments } = first.payload;
  const editorContext = first.payload.editor?.context;
  const cover = first.payload.editor?.cover;
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
      ...(cover ? { cover } : {}),
      ...(first.payload.editor?.postCaption ? { postCaption: first.payload.editor.postCaption } : {}), // CAP1
      ...commentIds(comments), // EDT1-CMT
    },
  });
}
