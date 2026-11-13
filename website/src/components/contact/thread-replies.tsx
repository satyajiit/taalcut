// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: thread replies · Taalcut's answer to a topic, and its note while the form is closed
 * mode: Persuade · system: WEB2 Remix Vernacular (Taalcut's bubbles; addresses and pages inside one are links)
 * states: links default (ink, rule-strong underline) · hover (underline ink) · focus (base ring) · popping (the
 *   answer grows in after Taalcut types; a fade under reduced motion) */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ContactChip } from '#content/contact';
import { CONTACT_WORDS } from '#content/forms';
import { SITE } from '#content/site';
import { INLINE_LINK } from './styles';
import { Bubble } from './thread-parts';

const PRESS_PAGE = 'press page';

/** A reply's words with the address as a mailto link and "press page" as the link to it. */
export function linked(text: string): ReactNode[] {
  const pattern = new RegExp(
    `(${[SITE.email, PRESS_PAGE].map((w) => w.replace(/[.]/g, '\\.')).join('|')})`,
    'g',
  );
  return text.split(pattern).map((part, i) => {
    if (part === SITE.email)
      return (
        <a key={i} href={`mailto:${part}`} className={INLINE_LINK}>
          {part}
        </a>
      );
    if (part === PRESS_PAGE)
      return (
        <Link key={i} href="/press/" className={INLINE_LINK}>
          {part}
        </Link>
      );
    return part;
  });
}

/** Taalcut's answer to the topic you picked. Closed, it also names the address. */
export function TopicReply({ chip, open }: { readonly chip: ContactChip; readonly open: boolean }) {
  const words =
    open || chip.reply.includes(SITE.email) ? chip.reply : `${chip.reply} Write to ${SITE.email}.`;
  return (
    <Bubble side="taalcut" pop>
      {linked(words)}
    </Bubble>
  );
}

/** While the form is closed (no Firebase config): where to write instead. */
export function ClosedBubble() {
  return (
    <Bubble side="taalcut" className="mt-1">
      {CONTACT_WORDS.closed}{' '}
      <a href={`mailto:${SITE.email}`} className={INLINE_LINK}>
        {SITE.email}
      </a>{' '}
      {CONTACT_WORDS.closedTail}{' '}
      <a href={SITE.instagram.url} rel="me noopener noreferrer" className={INLINE_LINK}>
        {SITE.instagram.handle}
      </a>{' '}
      {CONTACT_WORDS.closedEnd}
    </Bubble>
  );
}
