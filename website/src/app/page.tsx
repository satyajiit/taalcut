// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* page: home · mode: Persuade · system: WEB2 Remix Vernacular
 * The first viewport is lane L1's hero, which marks itself as the page's hero for the nav's tint. Under it, the launch film
 * (2026-11-07). Below that, paced like a studio
 * (a dense section, then a quieter one, the grounds alternating): the two problems (the roll you never sorted, the
 * reel you saved and never made), Paste, pick, approve as three stories, the feature tour (the five parts of the reel
 * pass), More ways to make (the six features beyond it, WEB3), the starter formats, your AI, what a month of videos
 * costs (WEB3: it follows from the AI you choose, so it shares Your AI's canvas), private by default, platforms, Kaatu,
 * three questions, and the download close. Grounds from the tour down: sunken, canvas, sunken, canvas… to the questions
 * on canvas over the download band's panel.
 * states: each section's own · motion: one arrival a section, each demo's own run, every one with a pause or a
 *   Play again; reduced motion shows every finished state */

import { Hero } from '#components/hero/hero';
import { FaqTeaser } from '#components/home/faq-teaser';
import { FeatureTour } from '#components/home/feature-tour';
import { HowItWorks } from '#components/home/how-it-works';
import { LaunchFilm } from '#components/home/launch-film';
import { MeetKaatu } from '#components/home/meet-kaatu';
import { MoreWays } from '#components/home/more-ways';
import { PlatformsStrip } from '#components/home/platforms-strip';
import { PrivateDefault } from '#components/home/private-default';
import { RollProblem } from '#components/home/roll-problem';
import { SavedProblem } from '#components/home/saved-problem';
import { StarterFormats } from '#components/home/starter-formats';
import { WhatItCosts } from '#components/home/what-it-costs';
import { YourAi } from '#components/home/your-ai';
import { JsonLd } from '#components/ui/json-ld';
import { DownloadBand } from '#components/download/download-band';
import { softwareApplicationJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

export const metadata = pageMetadata('/');

export default function HomePage() {
  return (
    <>
      <JsonLd data={softwareApplicationJsonLd()} />
      {/* The hero marks itself as the page's hero, for the nav's tint. */}
      <Hero />
      <LaunchFilm />
      <RollProblem />
      <SavedProblem />
      <HowItWorks />
      <FeatureTour />
      <MoreWays />
      <StarterFormats />
      <YourAi />
      <WhatItCosts />
      <PrivateDefault />
      <PlatformsStrip />
      <MeetKaatu />
      <FaqTeaser />
      <DownloadBand source="home-close" />
    </>
  );
}
