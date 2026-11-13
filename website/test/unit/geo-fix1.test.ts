// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { page, PAGES } from '#content/pages';
import { PLATFORM_GETS, PLATFORMS } from '#content/platforms';
import { WAITLIST_PAGE } from '#content/waitlist';
import { SITE } from '#content/site';
import { organizationJsonLd, softwareApplicationJsonLd } from '#lib/jsonld';
import { llmsFullTxt } from '#lib/llms/llms-txt';
import { facts } from '#lib/llms/markdown';
import { pageMarkdown } from '#lib/llms/pages-md';
import { pageMetadata, rootMetadata, SOCIAL } from '#lib/seo';
import { read } from './source-files';

/** Fix round 1's GEO findings: the social card on every page, honest JSON-LD, one robots meta, the waitlist's facts. */

describe('social metadata (G6)', () => {
  it('keeps og:type, og:site_name, og:locale and the large card on every page', () => {
    for (const entry of PAGES) {
      const meta = pageMetadata(entry.path);
      expect(meta.openGraph, entry.path).toMatchObject({ type: 'website', siteName: 'Taalcut', locale: 'en', title: entry.title, url: entry.path });
      expect(meta.twitter, entry.path).toMatchObject({ card: 'summary_large_image', title: entry.title });
    }
  });

  it('shares one source with the root', () => {
    const root = rootMetadata();
    expect(root.openGraph).toMatchObject(SOCIAL.openGraph);
    expect(root.twitter).toMatchObject(SOCIAL.twitter);
  });
});

describe('SoftwareApplication JSON-LD (G7)', () => {
  const app = softwareApplicationJsonLd();

  it('offers nothing that can be ordered, and says it is free', () => {
    expect(app).not.toHaveProperty('offers');
    expect(JSON.stringify(app)).not.toMatch(/availability|PreOrder|InStock/);
    expect(app.isAccessibleForFree).toBe(true);
  });

  it('names only the platforms with a beta coming', () => {
    expect(app.operatingSystem).toBe('macOS 14 Sonoma or later, Ubuntu 24.04');
  });
});

describe('the company in JSON-LD (WEB2 CO)', () => {
  const company = {
    '@type': 'Organization',
    '@id': 'https://matterwardlabs.com/#organization',
    name: 'Matterward Labs Private Limited',
    url: 'https://matterwardlabs.com',
    email: 'admin@matterwardlabs.com',
  };

  it('is Taalcut’s parent organisation, and Taalcut’s address is the one address', () => {
    const org = organizationJsonLd();
    expect(org.parentOrganization).toEqual(company);
    expect(org.email).toBe(SITE.email);
    expect(SITE.email).toBe('admin@matterwardlabs.com');
  });

  it('publishes the app', () => {
    expect(softwareApplicationJsonLd().publisher).toEqual(company);
  });

  it('names no old mailbox anywhere in the JSON-LD', () => {
    expect(JSON.stringify([organizationJsonLd(), softwareApplicationJsonLd()])).not.toMatch(/@taalcut\.app/);
  });
});

describe('robots (G8)', () => {
  it('leaves the 404’s one robots meta to Next', () => {
    expect(rootMetadata()).not.toHaveProperty('robots');
    expect(read('src/app/not-found.tsx')).not.toMatch(/\brobots\s*:/);
  });
});

describe('the waitlist’s facts in the machine-readable files (G9)', () => {
  const block = facts(WAITLIST_PAGE.facts);

  it('are in the /waitlist/ mirror', () => {
    const md = pageMarkdown(page('/waitlist/'));
    expect(md).toContain(`## ${WAITLIST_PAGE.nextHeading}`);
    expect(md).toContain(block);
  });

  it('are in llms-full.txt', () => {
    expect(llmsFullTxt()).toContain(block);
  });
});

describe('platforms (G2)', () => {
  it('say what each will get, and Ubuntu is 24.04 only', () => {
    for (const p of PLATFORMS) expect(PLATFORM_GETS[p.id], p.id).toMatch(/^You get /);
    const ubuntu = JSON.stringify(PLATFORMS.find((p) => p.id === 'ubuntu'));
    expect(ubuntu).not.toContain('22.04');
    expect(read('src/app/download/page.tsx')).not.toMatch(/'Supported'|Coming soon/);
  });
});
