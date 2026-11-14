// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { PageArrival } from '#components/contact/page-arrival';
import { ThanksStatus } from '#components/premium/thanks-status';
import { JsonLd } from '#components/ui/json-ld';
import { page } from '#content/pages';
import { PREMIUM, THANKS } from '#content/premium';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /premium/thanks/ · where the payment page sends a buyer back · mode: Read · system: WEB2 Remix Vernacular
 * The payment provider returns the browser here with the payment's five values in the address. The page hands them to
 * the billing service and shows what it says: paid, not seen yet, expired, cancelled, not matched, or out of reach;
 * opened any other way, it says there is nothing to check. Every state carries the address. Unlisted: off the
 * sitemap, llms.txt and the .md mirrors. No download band: this page is about one order.
 * states: thanks-status.tsx's. Without JavaScript: the heading, and one line saying the check needs it. */

const PATH = '/premium/thanks/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <div className="overflow-x-clip px-gutter pt-10 pb-section-bottom sm:pt-14">
        <div className="mx-auto flex max-w-4xl flex-col gap-10">
          <PageArrival className="flex flex-col gap-5">
            <h1 className="m-0 type-site-display text-balance text-ink">{entry.title}</h1>
            <p className="m-0 max-w-[34em] type-site-lead text-ink-2">{THANKS.lead}</p>
          </PageArrival>
          <ThanksStatus />
        </div>
      </div>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: PREMIUM.name, path: PREMIUM.path },
          { name: entry.title, path: PATH },
        ])}
      />
    </>
  );
}
