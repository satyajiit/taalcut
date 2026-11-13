// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: conversation-list · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * motion: shared-geometry hover mark glides between rows (--dur-micro, --ease-out); current mark glides when
 *   switching chats (--dur-short, --ease-out)
 * states: default (ink-2 row) · hover (gliding hover surface, ink) · focus (base ring) · active (pressed)
 *   · current (raised pill, ink) · empty (quiet single-line note) */

import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { CurrentIndicator, HoverIndicator } from '../sidebar/current-indicator';

export interface ConversationListItem {
  id: string;
  /** Written by the user or the agent: shown as is. Empty means untitled. */
  title: string;
  /** Epoch milliseconds of the last message. */
  updatedAt: number;
}

export interface ConversationLinkProps {
  className: string;
  'aria-current'?: 'page';
  children: ReactNode;
}

export interface ConversationListProps {
  conversations: readonly ConversationListItem[];
  activeId?: string;
  /** Renders the link to a conversation (the router's Link, in the app). */
  renderLink: (conversation: ConversationListItem, props: ConversationLinkProps) => ReactNode;
  className?: string;
}

/** Your chats, newest first, as a quiet typographic navigation list. */
export function ConversationList({ conversations, activeId, renderLink, className }: ConversationListProps) {
  const { t } = useLingui();
  const format = useFormatters();
  const sorted = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );
  return (
    <nav
      aria-label={t`Chats`}
      data-slot="conversation-list"
      className={cn('flex min-w-0 flex-col gap-0.5', className)}
    >
      {sorted.length === 0 ? (
        <p className="m-0 px-3 py-1.5 text-sm text-ink-3">
          <Trans>No chats yet</Trans>
        </p>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">
          {sorted.map((conversation) => {
            const active = conversation.id === activeId;
            const label = conversation.title.replace(/\s+/g, ' ').trim();
            return (
              <li key={conversation.id} className="min-w-0">
                {renderLink(conversation, {
                  className: cn(
                    'group/row relative flex h-8 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md px-3 text-sm text-ink-2 no-underline',
                    'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:text-ink',
                    active && 'font-medium text-ink',
                  ),
                  ...(active ? { 'aria-current': 'page' as const } : {}),
                  children: (
                    <>
                      {active ? <CurrentIndicator scope="chats" /> : <HoverIndicator scope="chats" />}
                      <span
                        title={label || undefined}
                        // The tooltip is the person's own title: data, never translated (card protocol rule 2).
                        translate={label ? 'no' : undefined}
                        className="relative block min-w-0 flex-1 truncate"
                      >
                        {label ? (
                          <UserContent translate="no" className="truncate whitespace-nowrap">
                            {label}
                          </UserContent>
                        ) : (
                          t`New chat`
                        )}
                      </span>
                      <time
                        dateTime={new Date(conversation.updatedAt).toISOString()}
                        title={format.dateTime(conversation.updatedAt)}
                        className="relative hidden shrink-0 font-sans text-2xs text-ink-3 tabular-nums group-hover/row:inline group-focus-visible/row:inline"
                      >
                        {format.relativeDay(conversation.updatedAt)}
                      </time>
                    </>
                  ),
                })}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
