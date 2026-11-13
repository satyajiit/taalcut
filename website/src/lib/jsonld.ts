// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FAQ } from '#content/faq';
import { FEATURE_GROUPS, FEATURES } from '#content/features';
import { PLATFORMS } from '#content/platforms';
import type { FaqEntry } from '#content/schema';
import { SITE } from '#content/site';
import { absolute } from './seo';

/** Schema.org objects as plain JSON (rendered by components/ui/json-ld). Facts only, from src/content. */
export type JsonLdObject = Readonly<Record<string, unknown>>;

const ORG_ID = `${SITE.origin}/#organization`;

/** The company that makes Taalcut and runs the site: Taalcut's parent organisation and the app's publisher. */
export function companyJsonLd(): JsonLdObject {
  return {
    '@type': 'Organization',
    '@id': `${SITE.company.url}/#organization`,
    name: SITE.company.legal,
    url: SITE.company.url,
    email: SITE.email,
  };
}

export function organizationJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE.name,
    url: SITE.origin,
    logo: absolute('/brand/avatar-1024.png'),
    sameAs: [SITE.instagram.url],
    email: SITE.email,
    parentOrganization: companyJsonLd(),
  };
}

export function websiteJsonLd(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.origin}/#website`,
    name: SITE.name,
    url: SITE.origin,
    inLanguage: 'en',
    publisher: { '@id': ORG_ID },
  };
}

/**
 * The app, for the home page and /download/. No `offers`: nothing can be ordered or downloaded yet, so the price is
 * said only as `isAccessibleForFree`. The operating systems are the platforms with a beta coming (not Windows). The
 * publisher is the company that makes it. `featureList` names every feature page, in the index's order.
 */
export function softwareApplicationJsonLd(): JsonLdObject {
  const supported = PLATFORMS.filter((p) => p.status === 'supported');
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    description: SITE.description,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Video editor',
    operatingSystem: supported.map((p) => p.requirements.find(([k]) => k === 'System')?.[1] ?? p.name).join(', '),
    featureList: FEATURES.map((f) => f.name),
    isAccessibleForFree: true,
    license: SITE.licence.url,
    publisher: companyJsonLd(),
    url: SITE.origin,
  };
}

/**
 * /features/ as an ordered list of its feature pages, in its two parts (FEATURE_GROUPS) and the order the page shows
 * them: each item its name, its address and its one-sentence definition.
 */
export function featureIndexJsonLd(): JsonLdObject {
  const ordered = FEATURE_GROUPS.flatMap((g) => FEATURES.filter((f) => f.group === g.id));
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Taalcut features',
    numberOfItems: ordered.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: ordered.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: f.name,
      url: absolute(`/features/${f.slug}/`),
      description: f.definition,
    })),
  };
}

export function faqPageJsonLd(entries: readonly FaqEntry[] = FAQ): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer },
    })),
  };
}

export function breadcrumbJsonLd(trail: readonly { readonly name: string; readonly path: string }[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: absolute(step.path),
    })),
  };
}
