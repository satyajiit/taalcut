// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { LegalBody, LegalGist, LegalStatus } from '#components/content/legal-doc';
import { PageHead } from '#components/content/page-head';
import { JsonLd } from '#components/ui/json-ld';
import { WaitlistBand } from '#components/waitlist/waitlist-band';
import { PRIVACY, PRIVACY_GIST } from '#content/legal';
import { page } from '#content/pages';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /privacy/ · Privacy · mode: Read · system: WEB2 Remix Vernacular · lane L6
 * The privacy notice in plain language, from src/content/legal.ts, made comfortable to read: the date it last changed,
 * the gist in six icon rows (each linking to its section), then the sections beside a sticky table of contents. It
 * describes only what the site does; the facts are WEB1's, word for word.
 * states: the contents' and gist links' (legal-doc.tsx); one marigold fill: the band's waitlist button. */

const PATH = '/privacy/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={PRIVACY.definition} compact>
        <LegalStatus text={PRIVACY.status} />
      </PageHead>
      <LegalGist heading={PRIVACY_GIST.heading} rows={PRIVACY_GIST.rows} />
      <LegalBody doc={PRIVACY} label="Privacy notice sections" />
      <WaitlistBand source="privacy" />
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }])} />
    </>
  );
}
