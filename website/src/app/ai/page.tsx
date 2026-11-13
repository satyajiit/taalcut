// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { AiHeadArt } from '#components/your-ai/head-art';
import { ChatgptSection } from '#components/your-ai/chatgpt-section';
import { DeviceSection } from '#components/your-ai/device-section';
import { LocalSection } from '#components/your-ai/local-section';
import { ProvidersSection } from '#components/your-ai/providers-section';
import { PageHead } from '#components/content/page-head';
import { CostChoices } from '#components/home/what-it-costs';
import { JsonLd } from '#components/ui/json-ld';
import { WaitlistBand } from '#components/waitlist/waitlist-band';
import { MIRROR_LINES } from '#content/llms';
import { page } from '#content/pages';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /ai/ · Bring your own AI · mode: Persuade · system: WEB2 Remix Vernacular · lane L6
 * A showcase in four acts: Continue with ChatGPT played in the coded window (Settings › Accounts, the sign-in on
 * OpenAI's page, Using ChatGPT plan), every AI it works with by brand icon and name in three ways, the models on your
 * computer, and the profiles and Local only, working, in the window; then what each choice costs (WEB3: the home's
 * cost board beside its facts). Every fact is the ledger's: keys kept encrypted with a key in your computer's keychain,
 * the budget, the 9B model's 32 GB and 16 GPU cores, update checks under Local only, the owner's three prices. The
 * subscription sign-ins the ledger keeps off stay off.
 * states: the sections' own (your-ai/stories, your-ai/map, your-ai/device); sections arrive once each. One marigold
 *   fill: the band's. AI1 rebuilt every section in the world's vocabulary (SPEC.md › AI1). */

const PATH = '/ai/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <PageHead title={entry.title} lead={MIRROR_LINES.ai} art={<AiHeadArt />} />
      <ChatgptSection />
      <ProvidersSection />
      <DeviceSection />
      <LocalSection />
      <CostChoices />
      <WaitlistBand source="ai" />
      <JsonLd data={breadcrumbJsonLd([{ name: 'Home', path: '/' }, { name: entry.title, path: PATH }])} />
    </>
  );
}
