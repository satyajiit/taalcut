// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { CalendarClock, Info, Tag, Volume2, Wallet } from 'lucide-react';
import { MatterwardMark } from '#components/brand/matterward-mark';
import { CopyButton } from '#components/content/copy-button';
import { PressArt } from '#components/content/head-art';
import { type IconFact, IconFacts } from '#components/content/icon-facts';
import { InlineText } from '#components/content/inline-text';
import { PageHead } from '#components/content/page-head';
import { KaatuSheet } from '#components/content/press-kaatu';
import { Colours, Descriptions, Files, LogoTiles, Rules } from '#components/content/press-parts';
import { JsonLd } from '#components/ui/json-ld';
import { Arrive, Section } from '#components/ui/section';
import { DownloadBand } from '#components/download/download-band';
import { page } from '#content/pages';
import { PRESS } from '#content/press';
import { SITE } from '#content/site';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /press/ · Press kit · mode: Read/Act · system: WEB2 Remix Vernacular · lane L6
 * Everything a writer needs, nothing invented: the descriptions to copy, the facts as icon rows, the logo drawings
 * previewed on light and dark with their SVGs and rules, Kaatu's drawings as PNG stickers with its rules, the four
 * colours with their jobs and values to copy, the other files, and the press contact. No coverage, quotes or counts.
 * states: the copy buttons' and downloads' own; sections arrive once each. One marigold fill: the band's. */

const PATH = '/press/';
export const metadata = pageMetadata(PATH);

const FACT_ICONS = { Name: Tag, 'Say it': Volume2, 'What it is': Info, 'Made by': undefined, Platforms: undefined, Price: Wallet, Licence: undefined, Status: CalendarClock, Instagram: undefined } as const;
const facts: IconFact[] = PRESS.facts.map(([label, value]) => {
  const icon = FACT_ICONS[label as keyof typeof FACT_ICONS];
  if (label === 'Made by') return { label, value, mark: <MatterwardMark className="size-full" /> };
  if (label === 'Platforms') return { label, value, brand: 'apple' };
  if (label === 'Licence') return { label, value, brand: 'github' };
  if (label === 'Instagram') return { label, value, brand: 'instagram' };
  return { label, value, icon };
});

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={PRESS.oneLiner} art={<PressArt />}>
        <CopyButton text={PRESS.oneLiner} what="the one-line description" className="self-start" />
      </PageHead>

      <Section id="descriptions" heading="Describe Taalcut" tone="sunken">
        <Descriptions />
      </Section>

      <Section id="facts" heading="Facts">
        <IconFacts rows={facts} columns />
      </Section>

      <Section id="logo" heading="The logo" lead={PRESS.logoLead} tone="sunken">
        <LogoTiles />
        <div className="mt-12">
          <Rules items={PRESS.logoRules} />
        </div>
      </Section>

      <Section id="kaatu" heading="Kaatu, the mascot" lead={PRESS.kaatuLead}>
        <Arrive>
          <KaatuSheet />
        </Arrive>
        <div className="mt-12">
          <Rules items={PRESS.mascotRules} />
        </div>
      </Section>

      <Section id="colours" heading="The colours" lead={PRESS.coloursLead} tone="sunken">
        <Colours />
      </Section>

      <Section id="files" heading="More files">
        <Files />
      </Section>

      <Section id="contact" heading={PRESS.contactHeading} tone="sunken">
        <Arrive className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <p className="m-0 max-w-[36em] type-site-lead text-ink-2">
            <InlineText text={PRESS.contact} />
          </p>
          <CopyButton text={SITE.email} what="the press address" />
        </Arrive>
      </Section>

      <DownloadBand source="press" />
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }])} />
    </>
  );
}
