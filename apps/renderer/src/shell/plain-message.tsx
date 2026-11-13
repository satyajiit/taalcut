// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: message page (not found, a page that failed, the app's own error), the one implementation
 * system: DESIGN.md v0.6 "Message pages", UX4 page grid · plain text on the page's column, under the bar's title:
 *   Kaatu (80 px, decorative), the heading, one sentence and the way on as words. No box, no icon tile, no
 *   marigold fill. One top space for every message page (it was two).
 * mascot: bashful for a moment, then watching the pointer; hidden with Show Kaatu off, the words stay
 * states (the links): default (underlined, primary-strong) · hover (thicker underline) · focus (base ring) ·
 *   active · disabled: n/a
 */
import { Kaatu, useIdleMood } from '@taalcut/ui';
import type { HTMLAttributes, ReactNode } from 'react';
import { PageColumn, useDocumentTitle } from './page';
import { ToolbarTitle } from './toolbar';

/** The one link on a plain message page: words, underlined, in the primary's text tone. */
export const MESSAGE_LINK =
  'cursor-pointer text-md font-medium text-primary-strong underline decoration-1 underline-offset-4 hover:decoration-2';

export interface PlainMessageProps {
  /** Where you are, for the window bar and the window's title: "Page not found". Left out, the bar keeps the page's. */
  name?: string;
  /** The page's h1: what happened, in a few words. */
  title: ReactNode;
  /** One sentence: why, and that nothing is lost. */
  sentence: ReactNode;
  /** The way on: one link, or a fix and its alternatives as link-styled buttons (MESSAGE_LINK). */
  link: ReactNode;
  /**
   * In the app shell (not found, a page that failed): the shell gives the page its main landmark and the sidebar.
   * Alone (the shell itself failed): the message is the main landmark.
   */
  inShell?: boolean;
  /** An error: the heading and the sentence are read out as soon as they show. */
  alert?: boolean;
  /** For the heading's id (the section is named by it) and attributes that say what failed (data-cause…). */
  headingId?: string;
  section?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>;
}

/** A page with nothing to show but a message: Kaatu, a heading, one sentence and the way on. */
export function PlainMessage({
  name,
  title,
  sentence,
  link,
  inShell = false,
  alert = false,
  headingId,
  section,
}: PlainMessageProps) {
  const mood = useIdleMood({ startWith: 'oops' });
  const message = (
    <PageColumn className="pt-[min(12vh,6rem)] pb-10">
      {/* The page has its own heading; the bar just names where you are. */}
      {name ? <MessageName name={name} /> : null}
      <section
        {...section}
        {...(headingId ? { 'aria-labelledby': headingId } : {})}
        className="flex max-w-[60ch] flex-col items-start gap-3"
      >
        <Kaatu spot="message" mood={mood} className="mb-1" />
        <div {...(alert ? { role: 'alert' } : {})} className="flex flex-col gap-3">
          <h1 id={headingId} className="m-0 type-headline text-balance text-ink">
            {title}
          </h1>
          <p className="m-0 type-prose text-pretty text-ink-2">{sentence}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">{link}</div>
      </section>
    </PageColumn>
  );
  if (inShell) return message;
  return <main className="min-h-full bg-canvas">{message}</main>;
}

function MessageName({ name }: { name: string }) {
  useDocumentTitle(name);
  return <ToolbarTitle as="p" title={name} />;
}
