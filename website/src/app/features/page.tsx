// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FeatureHeader } from '#components/showcase/feature-header';
import { FeatureIndex } from '#components/showcase/feature-index';
import { JsonLd } from '#components/ui/json-ld';
import { DownloadBand } from '#components/download/download-band';
import { FEATURES, FEATURES_INDEX } from '#content/features';
import { page } from '#content/pages';
import { breadcrumbJsonLd, featureIndexJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /features/ · mode: Persuade · system: WEB2 Remix Vernacular
 * the answer-first header (the h1, every feature in one sentence, stickers and Kaatu), then the eleven features as one
 * list in two parts (FEATURE_GROUPS: make it like the reel you saved, then more ways to make), each part's heading row
 * and its features as large rows, each with its summary, two facts and a working fragment of its showcase in a coded
 * app window, then the download band. JSON-LD: the breadcrumb, and the features as an ordered ItemList. */

const PATH = '/features/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: entry.title, path: PATH },
        ])}
      />
      <JsonLd data={featureIndexJsonLd()} />
      <FeatureHeader
        title={FEATURES_INDEX.title}
        lead={FEATURES_INDEX.lead}
        lookKey="index"
        stickers={FEATURES_INDEX.stickers}
      />
      <FeatureIndex features={FEATURES} />
      <DownloadBand source="features" />
    </>
  );
}
