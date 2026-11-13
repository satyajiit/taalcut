// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import { newId, type ConversationId, type TaalcutError, type ConversationSummary } from '@taalcut/core';
import {
  Button,
  cn,
  ConversationList,
  errorMessage,
  FoldFade,
  FoldLabel,
  HoverIndicator,
  loadingTracker,
  RailTooltip,
  Skeleton,
  useSidebarFold,
  VERB_ICONS,
  type ConversationLinkProps,
  type ConversationListItem,
} from '@taalcut/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { CircleAlert, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';
// The chat list's captured skeleton bones load with it.
import '../bones/registry';
import { useBackendEvents } from '../backend/use-events';
import { useConversationsRevision, useServices } from '../services/provider';
import { NAV_ITEM_CLASS, RAIL_ITEM_CLASS } from './nav-item';
import { SCROLL_HINT_CLASS, useScrollHint } from './scroll-hint';

/* eslint-disable lingui/no-unlocalized-strings -- capture stand-in titles, never shown */
const FIXTURE: ConversationListItem[] = [
  { id: 'f1', title: 'Trip to Goa reel', updatedAt: 3 },
  { id: 'f2', title: 'Diwali highlights', updatedAt: 2 },
  { id: 'f3', title: 'Product teaser, 15 s', updatedAt: 1 },
];
/* eslint-enable lingui/no-unlocalized-strings */

function renderLink(conversation: ConversationListItem, props: ConversationLinkProps) {
  return (
    <Link
      to="/chat/$conversationId"
      params={{ conversationId: conversation.id as ConversationId }}
      {...props}
    >
      {props.children}
    </Link>
  );
}

/**
 * Your chats, in the main sidebar under the four areas: a clean new-chat
 * row, then the conversations, newest first. The list scrolls on its
 * own; the rest of the sidebar stays put. On the icon rail only the new-chat
 * icon stays, where it was; the heading keeps its room.
 */
export function RecentChats({ className }: { className?: string }) {
  const { t, i18n } = useLingui();
  const { rail } = useSidebarFold();
  const { chat } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [revision, conversationsChanged] = useConversationsRevision();
  // A chat named or renamed elsewhere (the agent titles it after the first exchange): reload the list.
  useBackendEvents(['library.changed'], (event) => {
    if (event.payload.entity === 'conversation') conversationsChanged();
  });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [newChatId, setNewChatId] = useState(() => newId<'Conversation'>());
  const hint = useScrollHint<HTMLDivElement>();
  // Reload when a conversation is created or changes, or another chat opens;
  // not on every page change elsewhere.
  const inChat = pathname === '/chat' || pathname.startsWith('/chat/') ? pathname : '';

  useEffect(() => {
    let live = true;
    void loadingTracker.track(chat.listConversations()).then((result) => {
      if (!live) return;
      if (result.ok) {
        setConversations(result.value);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [chat, inChat, revision, attempt]);

  // The chat's id is the segment after /chat/, so its review page (/chat/<id>/review/…) keeps it current.
  const activeId = pathname.startsWith('/chat/') ? pathname.slice('/chat/'.length).split('/')[0] : undefined;
  return (
    // The sidebar gives this 4 px on each side: the new-chat action and heading take them back,
    // the scrolling list keeps them as room for focus rings.
    <section
      aria-label={t`Recent chats`}
      data-slot="recent-chats"
      className={cn('flex min-h-0 min-w-0 flex-col gap-1', className)}
    >
      <RailTooltip label={t`New chat`} disabled={!rail}>
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: newChatId }}
          onClick={() => setNewChatId(newId<'Conversation'>())}
          className={cn(NAV_ITEM_CLASS, 'mx-1 w-auto', rail && RAIL_ITEM_CLASS)}
        >
          <HoverIndicator scope="sidebar" />
          <SquarePen
            aria-hidden
            className="relative size-4 shrink-0 text-ink-3 transition-colors duration-(--dur-micro) group-hover/row:text-ink-2"
          />
          <FoldLabel className="relative flex-1">
            <Trans>New chat</Trans>
          </FoldLabel>
        </Link>
      </RailTooltip>
      {/* On the rail the heading keeps its room, unseen and without its words: they would only overflow the rail. */}
      <FoldFade className={cn(rail && 'invisible')}>
        <h2 className="mx-1 my-0 truncate px-3 pt-2 pb-0.5 type-caption text-ink-3">
          {rail ? <>&nbsp;</> : <Trans>Recent chats</Trans>}
        </h2>
      </FoldFade>
      <FoldFade
        ref={hint.ref}
        data-more={hint.more}
        // Kept, hidden, on the rail: its scroll hint keeps watching the list for when it opens.
        className={cn(
          'scrollbar-thin min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1',
          SCROLL_HINT_CLASS,
          rail && 'hidden',
        )}
      >
        {error ? (
          // One quiet line in the sidebar's column: the cause, and the list's one fix, loading it again.
          <div
            role="alert"
            data-slot="recent-chats-error"
            className="flex flex-col items-start gap-1 px-3 py-1"
          >
            <p className="m-0 flex items-start gap-2 type-meta text-ink-2">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger-strong" />
              <span className="min-w-0">{errorMessage(i18n, error)}</span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.retry}
              className="-ms-2 h-7 px-2"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              {t`Try again`}
            </Button>
          </div>
        ) : (
          <Skeleton
            name="chat-conversations"
            loading={conversations === null}
            fixture={<ConversationList conversations={FIXTURE} renderLink={renderLink} />}
          >
            <ConversationList
              conversations={conversations ?? []}
              activeId={activeId}
              renderLink={renderLink}
            />
          </Skeleton>
        )}
      </FoldFade>
    </section>
  );
}
