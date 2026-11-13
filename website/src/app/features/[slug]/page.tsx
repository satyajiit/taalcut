// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import { AgentStage } from '#components/showcase/agent/agent-showcase';
import { AutoPickShowcase } from '#components/showcase/auto-pick/auto-pick-showcase';
import { BreakdownShowcase } from '#components/showcase/breakdown/breakdown-showcase';
import { EditorShowcase } from '#components/showcase/editor/editor-showcase';
import { FeatureHeader } from '#components/showcase/feature-header';
import { HowItWorks, NextFeature } from '#components/showcase/how-it-works';
import { lookOf } from '#components/showcase/look';
import { ShowcaseSection } from '#components/showcase/stage';
import { TemplatesShowcase } from '#components/showcase/templates/templates-showcase';
import { WhatItDoes } from '#components/showcase/what-it-does';
import { ImportShowcase } from '#components/showcase/import/entry';
import { ShortsShowcase } from '#components/showcase/shorts/entry';
import { EditsShowcase } from '#components/showcase/instagram-edits/entry';
import { LaunchShowcase } from '#components/showcase/launch-videos/entry';
import { ProductShowcase } from '#components/showcase/product-videos/entry';
import { PluginsShowcase } from '#components/showcase/plugins/entry';
import { JsonLd } from '#components/ui/json-ld';
import { DownloadBand } from '#components/download/download-band';
import { FEATURE_STEPS, FEATURE_STICKERS, FEATURES, feature, nextFeature } from '#content/features';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: a feature · mode: Persuade · system: WEB2 Remix Vernacular
 * the answer-first header (the name as the h1, its definition, its facts as stickers, Kaatu), the feature working in
 * the coded app window (a reel beside it where the feature is about one), what it does as fact rows each with its own
 * small scene, how it works in two or three steps, the next feature, and the download band. Everything is in the exported
 * HTML; the showcases add their interactions once the page's script runs. */

export const dynamicParams = false;

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return pageMetadata(`/features/${slug}/`);
}

const SHOWCASES: Readonly<Record<string, ComponentType>> = {
  'reel-breakdown': BreakdownShowcase,
  'auto-pick': AutoPickShowcase,
  templates: TemplatesShowcase,
  agent: AgentStage,
  editor: EditorShowcase,
  'import': ImportShowcase,
  'shorts': ShortsShowcase,
  'instagram-edits': EditsShowcase,
  'launch-videos': LaunchShowcase,
  'product-videos': ProductShowcase,
  'plugins': PluginsShowcase,
};

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = feature(slug);
  const look = lookOf(slug);
  const next = nextFeature(slug);
  const Showcase = SHOWCASES[slug];
  const path = `/features/${f.slug}/`;
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Features', path: '/features/' },
          { name: f.name, path },
        ])}
      />
      <FeatureHeader
        title={f.name}
        lead={f.definition}
        lookKey={slug}
        stickers={FEATURE_STICKERS[slug] ?? []}
      />
      {Showcase ? (
        <ShowcaseSection id="showcase" slug={slug}>
          <Showcase />
        </ShowcaseSection>
      ) : null}
      <WhatItDoes slug={slug} facts={f.facts} job={look.job} />
      <HowItWorks steps={FEATURE_STEPS[slug] ?? []} job={look.job} />
      <NextFeature next={next} />
      <DownloadBand source={`feature-${f.slug}`} />
    </>
  );
}
