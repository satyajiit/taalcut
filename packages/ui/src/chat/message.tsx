// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: chat-message · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (A1) · states: settled · streaming (aria-busy; the AI mark sits on a soft violet halo that
 *   fades in and out once, no loop) · sending and not sent (yours: the footer says so) · not interactive
 * UX round 1: your words in a compact sunken bubble with no edge and no shadow, as DESIGN.md says; the AI mark's
 *   infinite pulse is gone (the working line is the one thing that moves while a run goes)
 * pre-emit critique: P5 H5 E5 S4 R5 V4 */

import { useLingui } from '@lingui/react/macro';
import { memo, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { AiMark } from '../components/ai-mark';
import { UserContent } from '../cards/card-frame';
import { MarkdownText } from './markdown-text';

export type ChatRole = 'agent' | 'user';

export interface ChatMessageProps {
  role: ChatRole;
  /** The message text, as written: never translated. */
  text: string;
  /** Text is still arriving: marks the message busy. */
  streaming?: boolean;
  /** Under the text, e.g. "Stopped". */
  footer?: ReactNode;
  /** Above your words: what the message pointed at (selection chips, P2-M7). User messages only. */
  attachments?: ReactNode;
  className?: string;
}

/**
 * One chat message (DESIGN.md v0.3, A1). The agent's words sit on the canvas,
 * unboxed, led by the AI mark and "Taalcut" in ink-2, at prose size and
 * measure. Yours sit in a compact raised/sunken studio bubble on the right.
 * Authorship is also a word (visible for the agent, read out for you),
 * so colour and position are never the only signal.
 */
export const ChatMessage = memo(function ChatMessage({
  role,
  text,
  streaming = false,
  footer,
  attachments,
  className,
}: ChatMessageProps) {
  const { t } = useLingui();
  if (role === 'user') {
    return (
      <article
        data-slot="chat-message"
        data-role="user"
        className={cn(
          'max-w-[min(60ch,85%)] self-end rounded-2xl rounded-br-sm bg-bubble px-4 py-2.5 text-md text-ink',
          className,
        )}
      >
        <span className="sr-only">{t`You`}: </span>
        {attachments ? <div className="mb-1.5 flex flex-wrap gap-1">{attachments}</div> : null}
        <p className="m-0 leading-relaxed break-words">
          <UserContent>{text}</UserContent>
        </p>
        {footer ? (
          <footer className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">{footer}</footer>
        ) : null}
      </article>
    );
  }
  return (
    <article
      data-slot="chat-message"
      data-role="agent"
      data-streaming={streaming || undefined}
      aria-busy={streaming || undefined}
      className={cn('flex max-w-[65ch] flex-col gap-2 text-md text-ink', className)}
    >
      <header className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <span className="relative inline-flex size-5 items-center justify-center">
          {/* While the words arrive the mark sits on a soft halo: one fade in and out, never a loop. */}
          <span
            aria-hidden
            className={cn(
              'absolute inset-0 rounded-pill bg-ai-soft opacity-0 transition-opacity duration-(--dur-short) ease-(--ease-out)',
              streaming && 'opacity-100',
            )}
          />
          <AiMark className="relative size-3.5" />
        </span>
        <span>{t`Taalcut`}</span>
      </header>
      <MarkdownText text={text} />
      {footer ? <footer className="text-sm text-ink-2">{footer}</footer> : null}
    </article>
  );
});
