// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ORDER, PREMIUM_MIRROR, PREMIUM_PAGE, PREMIUM_QUESTIONS } from '#content/premium';
import { bullets, doc, facts, heading, inline } from './markdown';

/**
 * /premium/ as Markdown, from content/premium.ts: the page's own words in the page's order. The price is the list
 * price: a launch price exists only in the billing service's quote, so the mirror says where it shows, never a number.
 */
export function premiumMarkdown(): string {
  const P = PREMIUM_PAGE;
  return doc(
    P.lead,
    PREMIUM_MIRROR.price,
    bullets(P.card.facts),
    heading(2, P.included.heading),
    P.included.lead,
    bullets(P.included.rows.map(([, value]) => value)),
    heading(2, P.activation.heading),
    bullets(P.activation.steps.map((step) => `${step.title}: ${step.body}`)),
    heading(2, P.notes.heading),
    facts(P.notes.rows),
    heading(2, P.questions.heading),
    ...PREMIUM_QUESTIONS.flatMap((entry) => [heading(3, entry.question), entry.answer]),
    heading(2, ORDER.heading),
    inline(PREMIUM_MIRROR.order),
    inline(ORDER.india),
  );
}
