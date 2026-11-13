// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FaqBrowser } from '#components/content/faq-browser';
import { FaqArt } from '#components/content/head-art';
import { PageHead } from '#components/content/page-head';
import { JsonLd } from '#components/ui/json-ld';
import { DownloadBand } from '#components/download/download-band';
import { page } from '#content/pages';
import { breadcrumbJsonLd, faqPageJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /faq/ · Questions · mode: Read · system: WEB2 Remix Vernacular · lane L6
 * Answers written for people and engines alike: Kaatu searching beside the title, then the questions grouped by
 * topic under their icons, as an accordion with search-as-you-type. Every question is an h3 whose id is the entry's
 * (/faq/#footage-leaves opens and lands on it); without JavaScript every answer shows. The FAQPage JSON-LD carries
 * every question and answer as written.
 * states: the browser's (faq-browser.tsx); one marigold fill: the band's Download for Mac. */

const PATH = '/faq/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={entry.description} art={<FaqArt />} />
      <FaqBrowser />
      <DownloadBand source="faq" />
      <JsonLd data={[faqPageJsonLd(), breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }])]} />
    </>
  );
}
