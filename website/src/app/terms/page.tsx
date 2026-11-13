// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { LegalBody, LegalStatus } from '#components/content/legal-doc';
import { PageHead } from '#components/content/page-head';
import { JsonLd } from '#components/ui/json-ld';
import { DownloadBand } from '#components/download/download-band';
import { TERMS } from '#content/legal';
import { page } from '#content/pages';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /terms/ · Terms · mode: Read · system: WEB2 Remix Vernacular · lane L6
 * The site's terms in plain language, from src/content/legal.ts: the date they last changed, then the sections beside
 * a sticky table of contents with an icon each. They cover the site, and what the closed waitlist still promises.
 * states: the contents links' (legal-doc.tsx); one marigold fill: the band's Download for Mac. */

const PATH = '/terms/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={TERMS.definition} compact>
        <LegalStatus text={TERMS.status} />
      </PageHead>
      <LegalBody doc={TERMS} label="Terms sections" />
      <DownloadBand source="terms" />
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }])} />
    </>
  );
}
