// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { Mail, MapPin, RefreshCw, ToggleRight, Wrench } from 'lucide-react';
import { MatterwardMark } from '#components/brand/matterward-mark';
import { type IconFact, IconFacts } from '#components/content/icon-facts';
import { PageHead } from '#components/content/page-head';
import { AppWindow } from '#components/ui/app-window';
import { JsonLd } from '#components/ui/json-ld';
import { Arrive, Section } from '#components/ui/section';
import { WaitlistBand } from '#components/waitlist/waitlist-band';
import { BETA_TERMS } from '#content/legal';
import { page } from '#content/pages';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { ICON_STROKE } from '#lib/icons';
import { pageMetadata } from '#lib/seo';

/* page: /beta-terms/ · Beta terms · mode: Read · system: WEB2 Remix Vernacular · lane L6
 * The app links here (betaTermsUrl) before you switch to the beta channel. It shows the app's three plain lines as the
 * app writes them, in the coded window's Settings › About where the app shows them, each with its icon, and says
 * where they appear, who makes Taalcut, and that the full terms come before the beta.
 * states: n/a (static; the window's controls are drawings; the mail link takes InlineText's states) */

const PATH = '/beta-terms/';
export const metadata = pageMetadata(PATH);

const LINE_ICONS = [Wrench, RefreshCw, ToggleRight] as const;

const notes: IconFact[] = [
  { label: 'On Ubuntu', value: BETA_TERMS.ubuntuNote, brand: 'ubuntu' },
  { label: 'Where you see them', value: BETA_TERMS.where, icon: MapPin },
  { label: 'Who makes Taalcut', value: BETA_TERMS.who, mark: <MatterwardMark className="size-full" /> },
  { label: 'Questions', value: BETA_TERMS.questions, icon: Mail, tone: 'you' },
];

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={BETA_TERMS.definition} compact />

      <Section id="lines" heading="The three lines" tone="sunken">
        <div className="grid items-start gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Arrive>
            <AppWindow title="Settings" area="settings" size="sm" sidebar={false} pageClassName="flex flex-col gap-5 bg-panel p-6">
              <div className="flex items-baseline justify-between gap-4">
                <span className="type-section text-ink">Switch to the beta</span>
                <span className="type-meta text-ink-3">Settings › About</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {BETA_TERMS.lines.map((line, i) => {
                  const Icon = LINE_ICONS[i] ?? Wrench;
                  return (
                    <li key={line} className="flex items-start gap-3 rounded-xl border border-rule-subtle bg-raised p-4">
                      <span aria-hidden className="inline-grid size-9 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet-strong">
                        <Icon strokeWidth={ICON_STROKE} className="size-4" />
                      </span>
                      <span className="pt-1.5 type-body text-pretty text-ink">{line}</span>
                    </li>
                  );
                })}
              </ul>
              <span aria-hidden className="flex items-center justify-end gap-3">
                <span className="type-label text-ink-2 underline decoration-rule-strong underline-offset-4">Read the beta terms</span>
                <span className="inline-flex h-9 items-center rounded-pill border border-rule bg-control px-4 type-label text-ink">Switch to beta</span>
              </span>
            </AppWindow>
          </Arrive>
          <IconFacts rows={notes} className="lg:pt-4" />
        </div>
      </Section>

      <WaitlistBand source="beta-terms" />
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }])} />
    </>
  );
}
