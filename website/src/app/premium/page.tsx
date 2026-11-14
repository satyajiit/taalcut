// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { OrderSection } from '#components/premium/order-section';
import { PremiumHead } from '#components/premium/premium-head';
import { PremiumQuestions } from '#components/premium/premium-questions';
import { PremiumActivation, PremiumIncluded, PremiumNotes } from '#components/premium/premium-sections';
import { QuoteProvider } from '#components/premium/quote-context';
import { JsonLd } from '#components/ui/json-ld';
import { page } from '#content/pages';
import { breadcrumbJsonLd, premiumJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /premium/ · Taalcut Premium · mode: Persuade · system: WEB2 Remix Vernacular
 * The paid plan around the free app. The head says what it is in two lines, with the plan's price as a card (the list
 * price in the server HTML; the billing service's quote once the page has it, a launch price when the quote carries
 * one). Then what you get as icon rows, the four steps from payment to an active plan, the plain notes before an
 * order (what it needs, where a make's material goes, fair use, what advice is, agency work, support hours, how
 * paying works), a short FAQ, and the order form in a reel-cornered panel: the page's one marigold fill.
 * No download band closes this page: its close is the order.
 * states: the price line's, the order form's and the questions' own. Without JavaScript every word is there, the
 *   price is the list price and the form says it needs JavaScript, with the address. */

const PATH = '/premium/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <QuoteProvider>
        <PremiumHead />
        <PremiumIncluded />
        <PremiumActivation />
        <PremiumNotes />
        <PremiumQuestions />
        <OrderSection />
      </QuoteProvider>
      <JsonLd
        data={[
          premiumJsonLd(),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: entry.title, path: PATH },
          ]),
        ]}
      />
    </>
  );
}
