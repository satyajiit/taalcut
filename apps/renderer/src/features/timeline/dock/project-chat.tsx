// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: project chat (docked) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the project's conversation beside the editor: the transcript (cards are live, a chip
 *   opens its clip here; an export approval's "Review and export" opens its review page under this chat, as the
 *   full chat's does, UX4), the composer pinned under it with what the editor has selected and the chips you added
 *   (⌘⇧A), which go with every message, with the editor as you see it (EDT1); no Kaatu: this is a work surface, so
 *   the working line is words only
 * states: empty (a line of what to ask) · loading (quiet lines) · error (the error card, Try again) · working
 *   ("Working on it…", Stop in the composer) · each control carries the kit's eight · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { ok, type ConversationId, type ReasoningLevel, type RunId } from '@taalcut/core';
import {
  CardActionsProvider,
  CardDataProvider,
  ErrorCard,
  SkeletonLines,
  useShortcutFormat,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { approvalIdsOf } from '../../../chat/approvals';
import { useChatCardActions, type ChatCardSurface } from '../../../chat/card-actions';
import { useAppCardData } from '../../../chat/card-data';
import { ChatComposer } from '../../../chat/chat-composer';
import { hasLiveActivity, isTalking } from '../../../chat/run-mood';
import { askWith, selectionStore, useCurrentSelection } from '../../../chat/selection-store';
import { TranscriptView } from '../../../chat/transcript-view';
import { useConversation, type MessageExtras } from '../../../chat/use-conversation';
import { EmptyRecipes } from '../../recipes/empty-recipes';
import { useRecipeContext } from '../../recipes/use-recipes';
import { useCommentSends } from '../comments/use-comment-sends';
import { useChatSends } from './chat-requests';
import { ACCELERATORS } from '../keys';
import { openEditor } from '../open-editor';
import { dockedContext } from './docked-context';
import { AppVariantPlayers } from '../variants/app-variant-players';

/**
 * The project's conversation (`ProjectSummary.conversationId`, the chat its runs were in; the timeline page
 * picks a new one for a project nobody wrote to yet). `undefined` while the project loads.
 */
export function ProjectChat({ conversationId }: { conversationId: ConversationId | undefined }) {
  if (conversationId === undefined) return <SkeletonLines lines={3} className="p-4" />;
  return <ProjectConversation key={conversationId} conversationId={conversationId} />;
}

function ProjectConversation({ conversationId }: { conversationId: ConversationId }) {
  const { t } = useLingui();
  const addKeys = useShortcutFormat().text(ACCELERATORS.addToChat);
  const state = useConversation(conversationId);
  const { transcript } = state;
  const runIdForApproval = useCallback(
    (approvalId: string) => {
      for (const item of transcript.items) {
        if (item.kind !== 'card') continue;
        const { card } = item;
        // Any card that asks (an approval, a cast board's or a gap's question), as the full chat answers them.
        if ('runId' in card && card.runId && approvalIdsOf(card).includes(approvalId))
          return card.runId as RunId;
      }
      return undefined;
    },
    [transcript.items],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const { stopRun, busy } = state;
  const navigate = useNavigate();
  // EDT1: what the editor has selected goes with every message, and the editor as you see it with it.
  const selected = useCurrentSelection();
  const { send: sendPlain } = state;
  const send = useCallback(
    (text: string, reasoning?: ReasoningLevel, extras?: MessageExtras) => {
      const live = selectionStore.currentSelection();
      const chips = [...(live ? [live] : []), ...(extras?.selections ?? [])];
      const added = selectionStore.selections().map((entry) => entry.chip);
      const editorContext = dockedContext(openEditor(), [...chips, ...added]);
      sendPlain(text, reasoning, {
        ...extras,
        selections: chips,
        ...(editorContext ? { editorContext } : {}),
      });
    },
    [sendPlain],
  );
  // What the dock's cards can do with its chat: stop a run, "Ask about this…" into its composer, and an approval's
  // review page.
  const surface = useMemo<ChatCardSurface>(
    () => ({
      async stopRun(runId) {
        stopRun(runId);
        return ok(undefined);
      },
      focusComposer: () => bar.current?.querySelector('textarea')?.focus(),
      ask: (text, selections) => askWith(text, selections),
      // A card's paid follow-up: your next message with its chips (while a run goes, into the composer).
      async followUp(_runId, text, selections) {
        if (busy) askWith(text, selections);
        else send(text, undefined, { selections: [...selections] });
        return ok(undefined);
      },
      // The approval's review page, under this project's chat (the agt lane's, UX4): the video first, Export under it.
      review(card) {
        void navigate({
          to: '/chat/$conversationId/review/$approvalId',
          params: { conversationId, approvalId: card.approvalId },
        });
      },
      busy,
    }),
    [stopRun, send, busy, navigate, conversationId],
  );
  const actions = useChatCardActions(runIdForApproval, state.answer, surface);
  // EDT1-CMT: "Send N comments to Taalcut" from the Comments tab, as one message once the chat is free.
  useCommentSends(send, state.status !== 'loading' && !busy);
  // HFW1-UI: the inspector's Try again on a designed graphic.
  useChatSends(send, state.status !== 'loading' && !busy);
  const cardData = useAppCardData();
  const atEnd = useRef(true);

  // New words keep the transcript at its end, unless you scrolled up to read.
  useEffect(() => {
    const box = scroller.current;
    if (box && atEnd.current) box.scrollTop = box.scrollHeight;
  }, [transcript.items]);

  const empty = state.status === 'ready' && transcript.items.length === 0 && !state.busy;
  const hold =
    state.status === 'loading'
      ? t`This chat is still opening. Your message can go in a moment.`
      : state.status === 'error'
        ? t`This chat didn’t open, so your message can’t go yet. Try again above.`
        : undefined;
  return (
    <div data-slot="project-chat" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-2"
        onScroll={(event) => {
          const box = event.currentTarget;
          atEnd.current = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
        }}
      >
        {state.status === 'loading' ? <SkeletonLines lines={3} /> : null}
        {empty ? (
          <>
            <p className="m-0 text-sm text-ink-2">
              {t`Ask for a change to this video: “a beat shorter”, “something calmer for clip 3”. Select a clip and press ${addKeys} to point at it.`}
            </p>
            <DockRecipes />
          </>
        ) : null}
        <CardActionsProvider value={actions}>
          <CardDataProvider value={cardData}>
            <AppVariantPlayers>
              <TranscriptView
                items={transcript.items}
                runs={transcript.runs}
                onStopRun={state.stopRun}
                outgoing={state.outgoing}
              />
            </AppVariantPlayers>
          </CardDataProvider>
        </CardActionsProvider>
        <p role="status" className="m-0 text-sm text-ink-2" data-slot="dock-working">
          {state.busy && !isTalking(transcript.items) && !hasLiveActivity(transcript)
            ? t`Working on it…`
            : ''}
        </p>
        {state.error ? (
          <ErrorCard error={state.error} onRetry={state.status === 'error' ? state.reload : undefined} />
        ) : null}
      </div>
      <div ref={bar} className="shrink-0 px-3 pb-3">
        <ChatComposer
          busy={state.busy}
          {...(hold ? { hold } : {})}
          onSend={(text, reasoning) => {
            atEnd.current = true;
            send(text, reasoning);
          }}
          selected={selected ? { chip: selected, onRemove: () => openEditor()?.focus(null, null) } : null}
          onStop={state.stop}
          {...(state.reasoning ? { reasoning: state.reasoning } : {})}
        />
      </div>
    </div>
  );
}

/** The empty dock chat's starters for the open project (its cut, a picked clip). */
function DockRecipes() {
  const context = useRecipeContext();
  return context.timeline ? <EmptyRecipes context={context} /> : null;
}
