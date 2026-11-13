// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · page: the export review (UX4, B8: the one approval becomes a page) · Operate, footage first
 * system: DESIGN.md v0.7 (Page on the reading column, crumbs, EmptyState) · the route under a chat that holds its
 *   one approval: "Agent › <the chat's name> › Review" in the bar, then the kit's ExportReview (the video, Export
 *   under it, the rest behind Options). It answers through the chat's own conversation, so the run streams on in the chat, and
 *   every way out (Escape, Export, Not now, Back to the chat) goes back to the chat as you left it. A swap made here
 *   closes the approval the page opened on and the run asks again under the same card: the page follows the card,
 *   and its link moves to the new approval.
 * states: loading (the stage's grey, busy) · the chat didn't open (the error card, Try again) · no such approval in
 *   this chat (an empty state with Back to the chat; Escape too) · the approval (ExportReview's own) */
import { useLingui } from '@lingui/react/macro';
import type { CardOf, ConversationId } from '@taalcut/core';
import {
  CardActionsProvider,
  CardDataProvider,
  EmptyState,
  ErrorCard,
  ExportReview,
  VERB_ICONS,
  Button,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistoryNav } from '../shell/nav/use-history-nav';
import { Page } from '../shell/page';
import { useChatCardActions, type ChatCardSurface } from './card-actions';
import { useAppCardData } from './card-data';
import { useOpenConversation, useRunIdForApproval } from './conversation-context';
import type { TranscriptItem } from './transcript';

/** The window's height less the bar and the page's top and foot: the stage's place while the chat opens. */
const STAGE_HEIGHT = 'max(20rem, calc(100dvh - var(--spacing-toolbar) - 11rem))';

type ApprovalCard = CardOf<'exportApproval'>;

/** The transcript's export card that `matches`, as the transcript has it now. */
function findCard(
  items: readonly TranscriptItem[],
  matches: (card: ApprovalCard) => boolean,
): ApprovalCard | null {
  for (const item of items)
    if (item.kind === 'card' && item.card.type === 'exportApproval' && matches(item.card)) return item.card;
  return null;
}

/**
 * The approval the page shows: the card the route's approval is on, and that card after the run asks again. A
 * stale approval is closed and the run's next one comes back under the same card id with a new approval id (agent
 * skill-cards.ts exportCardId), which the transcript puts in its place; the page follows the card, and moves its
 * link to the new approval so a reload or a step back comes to what you are looking at.
 */
function useFollowedApproval(
  items: readonly TranscriptItem[],
  approvalId: string,
  conversationId: ConversationId,
) {
  const navigate = useNavigate();
  const [cardId, setCardId] = useState<string | null>(null);
  const named = findCard(items, (card) => card.approvalId === approvalId);
  // Remembered as the page renders (React's "information from previous renders"), so the first render that has
  // lost the route's approval already finds its card.
  if (named && named.id !== cardId) setCardId(named.id);
  const card = named ?? (cardId === null ? null : findCard(items, (found) => found.id === cardId));
  const asked = card?.approvalId;
  useEffect(() => {
    if (asked === undefined || asked === approvalId) return;
    void navigate({
      to: '/chat/$conversationId/review/$approvalId',
      params: { conversationId, approvalId: asked },
      replace: true,
    });
  }, [asked, approvalId, conversationId, navigate]);
  return card;
}

/** Escape goes back to the chat while the page has no approval to show (ExportReview has its own keys). */
function useEscapeBack(active: boolean, back: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
        return;
      // Something on top of the page (a dialog, a menu, ⌘K) takes Escape first.
      if (
        document.querySelector('[role=dialog], [role=alertdialog], [role=menu], [data-slot=popover-content]')
      )
        return;
      event.preventDefault();
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, back]);
}

/** Back to the chat: a step back when you came from it (its scroll and focus come back), else a link to it. */
function useBackToChat(conversationId: ConversationId) {
  const navigate = useNavigate();
  const nav = useHistoryNav();
  const router = `/chat/${conversationId}`;
  return useCallback(() => {
    const previous = nav.previous?.replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (previous === router) nav.back();
    else void navigate({ to: '/chat/$conversationId', params: { conversationId } });
  }, [nav, navigate, router, conversationId]);
}

export function ReviewPage({ approvalId }: { approvalId: string }) {
  const { t, i18n } = useLingui();
  const { conversationId, state } = useOpenConversation();
  const back = useBackToChat(conversationId);
  const runIdForApproval = useRunIdForApproval(state.transcript.items);
  const surface = useMemo<ChatCardSurface>(() => ({ busy: state.busy }), [state.busy]);
  const actions = useChatCardActions(runIdForApproval, state.answer, surface);
  const cardData = useAppCardData();
  const card = useFollowedApproval(state.transcript.items, approvalId, conversationId);
  useEscapeBack(card === null && state.status !== 'loading', back);
  const variant = card?.variant;
  const at = variant ? i18n.number(variant.index) : '';
  const of = variant ? i18n.number(variant.count) : '';

  return (
    <Page title={t`Agent`} detail={variant ? t`Review video ${at} of ${of}` : t`Review`} width="reading">
      {state.status === 'loading' ? (
        <div
          data-slot="loading"
          aria-busy="true"
          aria-label={t`Opening the video…`}
          className="tc-viewer rounded-xl"
          style={{ height: STAGE_HEIGHT }}
        />
      ) : state.status === 'error' && state.error ? (
        <ErrorCard error={state.error} onRetry={state.reload} />
      ) : card ? (
        <CardActionsProvider value={actions}>
          <CardDataProvider value={cardData}>
            <ExportReview card={card} onBack={back} />
          </CardDataProvider>
        </CardActionsProvider>
      ) : (
        <EmptyState
          titleAs="h2"
          title={t`Nothing to review here`}
          description={t`This chat has no export waiting at this link. The chat has everything Taalcut made.`}
          action={
            <Button variant="primary" icon={VERB_ICONS.back} onClick={back}>
              {t`Back to the chat`}
            </Button>
          }
        />
      )}
    </Page>
  );
}
