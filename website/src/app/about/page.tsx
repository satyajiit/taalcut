// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { AudioLines, BookOpen, KeyRound, LoaderCircle, Moon, MousePointerClick, PartyPopper, Smile, Type, Undo2, Volume2 } from 'lucide-react';
import { AiMark } from '#components/brand/ai-mark';
import { MatterwardMark } from '#components/brand/matterward-mark';
import { AvartanCycle } from '#components/content/avartan-cycle';
import { AboutArt } from '#components/content/head-art';
import { FactIcon, type IconFact, IconFacts } from '#components/content/icon-facts';
import { PageHead } from '#components/content/page-head';
import { Kaatu } from '#components/kaatu/kaatu';
import { JsonLd } from '#components/ui/json-ld';
import { Arrive, Section } from '#components/ui/section';
import { DownloadBand } from '#components/download/download-band';
import { ABOUT, type Belief } from '#content/about';
import { page } from '#content/pages';
import { SITE } from '#content/site';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { absolute, pageMetadata } from '#lib/seo';
import { ICONS } from '#lib/icons';

/* page: /about/ · About Taalcut · mode: Persuade/Read · system: WEB2 Remix Vernacular · lane L6
 * The name's story in this world: Kaatu and the name's stickers beside the title; the name as icon rows; taal drawn
 * as the animated Avartan, one cycle of jhaptaal counted on arrival (the page's one orchestrated moment); Kaatu, named
 * from काटना (marked lang="hi"), large and pokeable beside its words; what Taalcut believes as icon rows; who makes it
 * (the company, with its mark), the code and where to follow. states: the cycle's own; Kaatu reacts to a click; links take InlineText's. */

const PATH = '/about/';
export const metadata = pageMetadata(PATH);

const NAME_ICONS = [Type, Volume2, AudioLines, BookOpen] as const;
const nameFacts: IconFact[] = ABOUT.name.facts.map(([label, value], i) => ({ label, value, icon: NAME_ICONS[i], tone: i === 2 ? 'beat' : 'muted' }));

const MOOD_ICONS = [LoaderCircle, PartyPopper, Moon] as const;
const moodFacts: IconFact[] = ABOUT.kaatu.moods.map(([label, value], i) => ({ label, value, icon: MOOD_ICONS[i] }));

const BELIEF_ICONS: Readonly<Record<Belief['id'], Pick<IconFact, 'icon' | 'mark' | 'tone'>>> = {
  agent: { mark: <AiMark className="size-full" />, tone: 'ai' },
  shows: { icon: Undo2, tone: 'you' },
  footage: { icon: ICONS.clip, tone: 'you' },
  defaults: { icon: Smile, tone: 'beat' },
  yours: { icon: KeyRound, tone: 'you' },
};

const codeFacts: IconFact[] = [
  { label: ABOUT.company.heading, value: ABOUT.company.body, mark: <MatterwardMark className="size-full" /> },
  { label: ABOUT.code.heading, value: ABOUT.code.body, brand: 'github' },
  { label: ABOUT.follow.heading, value: ABOUT.follow.body, brand: 'instagram' },
];

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={ABOUT.definition} art={<AboutArt />} />

      <Section id="name" heading={ABOUT.name.heading} lead={ABOUT.name.lead} tone="sunken">
        <IconFacts rows={nameFacts} columns />
      </Section>

      <Section id="avartan" heading={ABOUT.avartan.heading} lead={ABOUT.avartan.lead}>
        <Arrive>
          <AvartanCycle />
        </Arrive>
        <div className="mt-14 grid gap-x-12 gap-y-5 md:grid-cols-2">
          {ABOUT.avartan.body.map((line) => (
            <Arrive key={line} as="p" className="m-0 max-w-[38em] type-site-body text-pretty text-ink-2">
              {line}
            </Arrive>
          ))}
        </div>
      </Section>

      <Section id="kaatu" heading={ABOUT.kaatu.heading} tone="sunken">
        <div className="grid items-center gap-x-14 gap-y-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Arrive className="relative mx-auto grid aspect-square w-full max-w-[24rem] place-items-center">
            <span aria-hidden className="absolute inset-[6%] rounded-full bg-sticker-marigold" />
            <span aria-hidden className="absolute inset-[18%] rounded-full border-2 border-dashed border-sticker-marigold-ink/25" />
            {/* As large as its circle allows (the 480 px atlases stay sharp to 240 px on a 2x screen). */}
            <Kaatu pose="snip" size={208} interactive sticker className="relative [--kaatu-size:56%]" />
            <span className="absolute right-[-4%] bottom-[4%] inline-flex rotate-3 items-center gap-1.5 rounded-pill bg-raised px-3 py-1.5 type-sticker text-ink shadow-sticker">
              <MousePointerClick aria-hidden className="size-4" strokeWidth={2} />
              {ABOUT.kaatu.poke}
            </span>
          </Arrive>
          <div className="flex flex-col gap-8">
            <Arrive as="p" className="m-0 max-w-[34em] type-site-lead text-pretty text-ink">
              {ABOUT.kaatu.nameBefore}
              <span lang="hi">{ABOUT.kaatu.hindi}</span>
              {ABOUT.kaatu.nameAfter}
            </Arrive>
            <Arrive as="p" className="m-0 max-w-[38em] type-site-body text-pretty text-ink-2">
              {ABOUT.kaatu.body}
            </Arrive>
            <IconFacts rows={moodFacts} />
          </div>
        </div>
      </Section>

      <Section id="beliefs" heading={ABOUT.beliefs.heading}>
        <ol className="m-0 grid list-none gap-x-12 gap-y-10 p-0 md:grid-cols-2">
          {ABOUT.beliefs.items.map((b) => (
            <Arrive key={b.id} as="li" className="flex items-start gap-5">
              <FactIcon fact={BELIEF_ICONS[b.id]} size="lg" />
              <span className="flex min-w-0 flex-col gap-1.5 pt-1">
                <span className="type-site-subhead text-balance text-ink">{b.belief}</span>
                <span className="max-w-[36em] type-site-body text-pretty text-ink-2">{b.why}</span>
              </span>
            </Arrive>
          ))}
        </ol>
      </Section>

      <Section id="code" heading="Who makes it, the code, and where to follow" tone="sunken">
        <IconFacts rows={codeFacts} columns />
      </Section>

      <DownloadBand source="about" />
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'AboutPage',
            name: entry.title,
            description: entry.description,
            url: absolute(PATH),
            about: { '@id': `${SITE.origin}/#organization` },
          },
          breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }]),
        ]}
      />
    </>
  );
}
