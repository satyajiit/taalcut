// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: chat · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.2
 * The transcript on the canvas, the composer pinned under it, "Jump to latest" when you have scrolled
 * up. An empty chat is the start surface: Kaatu, heading, the four opening choices (P2-M13), the composer. While
 * the agent works, the working line (Kaatu, thinking) sits at the foot of the transcript. */

import { useLingui } from '@lingui/react/macro';
import { ok, type ReasoningLevel, type ConversationId } from '@taalcut/core';
import {
  Button,
  CARD_FIXTURES,
  CardActionsProvider,
  CardDataProvider,
  CardView,
  ChatMessage,
  CrossfadeText,
  ErrorCard,
  Skeleton,
  UserContent,
  WorkingLine,
  cn,
  useFocusFallback,
  useRunMood,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReportWork } from '../features/kaatu/use-companion-mood';
import { AppVariantPlayers } from '../features/timeline/variants/app-variant-players';
import { PageColumn, useDocumentTitle } from '../shell/page';
import { ToolbarTitle } from '../shell/toolbar';
import { useChatCardActions, type ChatCardSurface } from './card-actions';
import { useAppCardData } from './card-data';
import { addSelection } from './selection-store';
import { ChatComposer } from './chat-composer';
import { ChatEditorAction } from './chat-editor-action';
import { ChatStartIntro } from './chat-start';
import { clearComposerDraft, peekComposerDraft, takeMessageToSend } from './handoff';
import { NewChatChoices } from './new-chat-choices';
import { hasLiveActivity, isTalking, latestRun } from './run-mood';
import { TranscriptView } from './transcript-view';
import { useOpenConversation, useRunIdForApproval } from './conversation-context';
import { useStickToBottom } from './use-stick-to-bottom';

/* Capture stand-in text: never shown to anyone. */
const FIXTURE_ASK = "Add my Desktop/Trip folder and tell me what's in the first video";
const FIXTURE_ANSWER =
  'I added your Trip folder: 14 videos and 32 photos. The first video is 48 seconds long.';

/** Stand-in content for the skeleton capture (no IPC in the capture browser). */
function TranscriptFixture() {
  return (
    <div className="flex flex-col gap-5">
      <ChatMessage role="user" text={FIXTURE_ASK} />
      <CardView card={CARD_FIXTURES.plan.finished!} />
      <ChatMessage role="agent" text={FIXTURE_ANSWER} />
    </div>
  );
}

export function ConversationView({ conversationId }: { conversationId: ConversationId }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { state } = useOpenConversation();
  const { transcript } = state;
  const title = state.conversation?.title;
  const loading = state.status === 'loading';
  // The window title names the area (Mission Control, the Window menu); the bar shows the chat's name.
  useDocumentTitle(t`Agent`);

  const runIdForApproval = useRunIdForApproval(transcript.items);
  const cardData = useAppCardData();
  // A reel's link goes at once, like any message (REF1): no warning card holds it.
  const { send: sendMessage } = state;
  // Kaatu in the working line: thinking while a run goes, a short grin or bashful look as it ends.
  const run = useRunMood({ busy: state.busy, latest: latestRun(transcript) });
  // The companion in the sidebar thinks, grins or looks bashful with it.
  useReportWork(`chat:${conversationId}`, run.mood);

  // A draft another page left (Templates' paste-a-link field) opens in the composer; a card's Change puts
  // its words there too (a new composer with them in it, so the text box starts from them).
  const [composer, setComposer] = useState(() => ({ n: 0, draft: peekComposerDraft() }));
  const draft = composer.draft;
  useEffect(() => {
    if (composer.n === 0 && composer.draft) clearComposerDraft();
  }, [composer]);

  const empty =
    state.status === 'ready' && transcript.items.length === 0 && !state.busy && state.outgoing === null;
  // A message can't go until the chat has loaded: the composer keeps your words and says why (UX round 1).
  const hold =
    state.status === 'loading'
      ? t`This chat is still opening. Your message can go in a moment.`
      : state.status === 'error'
        ? t`This chat didn’t open, so your message can’t go yet. Try again above.`
        : undefined;
  const content = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const { atEnd, toEnd } = useStickToBottom(content, bar, !empty && !loading);

  const send = useCallback(
    (text: string, reasoning?: ReasoningLevel) => {
      if (state.status !== 'ready') return;
      // What you just sent is what you want to see.
      toEnd();
      sendMessage(text, reasoning);
    },
    [state.status, sendMessage, toEnd],
  );

  const focusComposer = useCallback(() => bar.current?.querySelector('textarea')?.focus(), []);
  // Dismissing a message that didn't go puts its words back in the composer, to change or send again.
  const { dismissError: dismiss } = state;
  const dismissError = useCallback(() => {
    const words = dismiss();
    if (!words) return;
    setComposer((was) => ({ n: was.n + 1, draft: words }));
    requestAnimationFrame(focusComposer);
  }, [dismiss, focusComposer]);
  // A card's button that goes away (Export, say) leaves focus on its card, or in the composer.
  const page = useRef<HTMLDivElement>(null);
  const composerField = useCallback(() => bar.current?.querySelector('textarea') ?? null, []);
  useFocusFallback(page, composerField);
  const { stopRun, busy, status } = state;
  const surface = useMemo<ChatCardSurface>(
    () => ({
      // An opening choice: its sentence as your message, and `start` (a reel's link goes with it at once).
      async startFlow(start, text) {
        if (status === 'ready' && !busy) {
          toEnd();
          sendMessage(text, undefined, { start });
        }
        return ok(undefined);
      },
      async stopRun(runId) {
        stopRun(runId);
        return ok(undefined);
      },
      focusComposer,
      ask(text, selections) {
        // "Ask about this slot": its chips go in the composer's tray with the words.
        for (const chip of selections) addSelection(chip);
        setComposer((was) => ({ n: was.n + 1, draft: text }));
        requestAnimationFrame(focusComposer);
      },
      // A card's paid follow-up ("Make more takes"): your next message, with its chips; the agent shows the cost
      // first. While a run goes it waits in the composer instead.
      async followUp(_runId, text, selections) {
        if (status === 'ready' && !busy) {
          toEnd();
          sendMessage(text, undefined, { selections: [...selections] });
        } else {
          for (const chip of selections) addSelection(chip);
          setComposer((was) => ({ n: was.n + 1, draft: text }));
        }
        return ok(undefined);
      },
      // The one approval is a page of its own under this chat (UX4): the video first, Export under it.
      review(card) {
        void navigate({
          to: '/chat/$conversationId/review/$approvalId',
          params: { conversationId, approvalId: card.approvalId },
        });
      },
      busy,
    }),
    [status, busy, sendMessage, toEnd, stopRun, focusComposer, navigate, conversationId],
  );
  const actions = useChatCardActions(runIdForApproval, state.answer, surface);

  // A message handed over by the new-chat page goes out once the chat is ready,
  // and the typing carries on here: focus stays in a composer.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const message = takeMessageToSend(conversationId);
    if (message)
      sendMessage(message.text, message.reasoning, message.start ? { start: message.start } : undefined);
    if (message || draft) bar.current?.querySelector('textarea')?.focus();
  }, [state.status, conversationId, sendMessage, draft]);

  return (
    // The reading column of the page grid (shell/page.tsx): the bar's title and the transcript share its edge.
    <PageColumn
      ref={page}
      width="reading"
      className={cn(
        'flex flex-1 flex-col',
        // The start surface sits high and still: opening a choice's panel moves only what is under it.
        empty ? 'gap-6 pt-[max(2.5rem,14vh)] pb-10' : 'pt-6',
      )}
    >
      {/* The chat's name goes in the window bar (the page's h1), after the area; nothing until it has opened. */}
      <ToolbarTitle
        title={t`Agent`}
        // A chat that didn't open has no name to show yet ("New chat" would say it's empty).
        {...(loading || state.status === 'error'
          ? {}
          : {
              // The agent names the chat after its first exchange: the new title crossfades in.
              detail: (
                <CrossfadeText value={title ?? ''}>
                  {title ? <UserContent className="whitespace-nowrap">{title}</UserContent> : t`New chat`}
                </CrossfadeText>
              ),
            })}
      />
      <ChatEditorAction projectId={state.conversation?.projectId} items={transcript.items} />
      {empty ? (
        <>
          <ChatStartIntro />
          <NewChatChoices actions={actions} busy={state.busy} onCreateShort={send} />
        </>
      ) : (
        <div ref={content} className="flex flex-1 flex-col gap-5 pb-6">
          <Skeleton name="chat-transcript" loading={loading} fixture={<TranscriptFixture />}>
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
          </Skeleton>
          <WorkingLine {...run} quiet={isTalking(transcript.items) || hasLiveActivity(transcript)} />
          {state.error ? (
            <ErrorCard
              error={state.error}
              onFix={actions.runFix}
              onRetry={state.status === 'error' ? state.reload : state.retrySend}
              onReport={actions.report}
              onDismiss={state.status === 'error' ? undefined : dismissError}
            />
          ) : null}
        </div>
      )}
      <div
        ref={bar}
        data-slot="chat-composer-bar"
        className={cn(
          'flex shrink-0 flex-col gap-6',
          !empty && 'sticky bottom-0 z-10 mt-auto bg-canvas pt-2 pb-6',
        )}
      >
        {!empty && !atEnd ? (
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-pill shadow-md"
            onClick={() => toEnd(true)}
          >
            <ArrowDown aria-hidden />
            {t`Jump to latest`}
          </Button>
        ) : null}
        {empty && state.error ? (
          <ErrorCard
            error={state.error}
            onFix={actions.runFix}
            onRetry={state.retrySend}
            onReport={actions.report}
            onDismiss={dismissError}
          />
        ) : null}
        <ChatComposer
          key={`${conversationId}:${composer.n}`}
          busy={state.busy}
          {...(hold ? { hold } : {})}
          onSend={send}
          onStop={state.stop}
          {...(draft ? { defaultDraft: draft } : {})}
          {...(state.reasoning ? { reasoning: state.reasoning } : {})}
          {...(state.conversation?.projectId ? { projectId: state.conversation.projectId } : {})}
        />
      </div>
    </PageColumn>
  );
}
