// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { page, PAGES } from '#content/pages';
import { PLATFORMS } from '#content/platforms';
import { RELEASE } from '#content/release';
import { SITE } from '#content/site';
import { organizationJsonLd, softwareApplicationJsonLd } from '#lib/jsonld';
import { llmsFullTxt, llmsTxt } from '#lib/llms/llms-txt';
import { listedPages } from '#lib/llms/mirror';
import { hasMarkdown, pageMarkdown } from '#lib/llms/pages-md';
import { pageMetadata, rootMetadata, SOCIAL } from '#lib/seo';
import { read } from './source-files';

/** Fix round 1's GEO findings: the social card on every page, honest JSON-LD, one robots meta; and the release. */

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

  it('sells nothing, and says it is free', () => {
    expect(app).not.toHaveProperty('offers');
    expect(JSON.stringify(app)).not.toMatch(/availability|PreOrder|InStock/);
    expect(app.isAccessibleForFree).toBe(true);
  });

  it('names only the platform the release has a download for, with its version, its file and its notes', () => {
    expect(app.operatingSystem).toBe('macOS 14 Sonoma or later');
    expect(app.processorRequirements).toBe('Apple silicon');
    expect(app.softwareVersion).toBe(RELEASE.version);
    expect(app.softwareVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.downloadUrl).toBe(RELEASE.download);
    expect(app.releaseNotes).toBe(RELEASE.page);
    expect(JSON.stringify(app)).not.toMatch(/Ubuntu|Windows|Linux/);
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

describe('the release (content/release.ts)', () => {
  it('derives the tag, the file and every address from the version, on the public repository', () => {
    expect(RELEASE.tag).toBe(`v${RELEASE.version}`);
    expect(RELEASE.file).toBe(`Taalcut-${RELEASE.version}-arm64.dmg`);
    expect(RELEASE.fileUrl).toBe(`https://github.com/satyajiit/taalcut/releases/download/${RELEASE.tag}/${RELEASE.file}`);
    expect(RELEASE.download).toBe('https://github.com/satyajiit/taalcut/releases/download/channel-stable/Taalcut-mac-arm64.dmg');
    expect(RELEASE.page).toBe(`https://github.com/satyajiit/taalcut/releases/tag/${RELEASE.tag}`);
    for (const url of [RELEASE.releases, RELEASE.issues, RELEASE.discussions]) expect(url.startsWith(`${SITE.repository}/`)).toBe(true);
    // It is an ordinary release, so GitHub's "latest" is a right address for the newest one.
    expect(RELEASE.latest).toBe('https://github.com/satyajiit/taalcut/releases/latest');
  });

  it('is in the machine-readable files: the download, the release’s page and the repository', () => {
    const md = pageMarkdown(page('/download/'));
    for (const url of [RELEASE.download, RELEASE.fileUrl, RELEASE.page, SITE.repository, RELEASE.issues]) expect(md, url).toContain(url);
    for (const text of [llmsTxt(), llmsFullTxt()]) {
      expect(text).toContain(RELEASE.version);
      expect(text).toContain(SITE.repository);
    }
  });
});

describe('the closed waitlist', () => {
  it('keeps its address, off the sitemap, llms.txt and the mirrors', () => {
    expect(page('/waitlist/')).toMatchObject({ unlisted: true });
    expect(listedPages().map((p) => p.path)).not.toContain('/waitlist/');
    expect(hasMarkdown('/waitlist/')).toBe(false);
    expect(llmsFullTxt()).not.toMatch(/taalcut\.app\/waitlist/);
  });

  it('is offered nowhere in the machine-readable files', () => {
    expect(`${llmsTxt()}\n${llmsFullTxt()}`).not.toMatch(/join (the|our) waitlist|opens with|private build|pre-?release/i);
  });
});

describe('platforms (G2)', () => {
  it('name Ubuntu as 24.04 only, and never a badge', () => {
    const ubuntu = JSON.stringify(PLATFORMS.find((p) => p.id === 'ubuntu'));
    expect(ubuntu).not.toContain('22.04');
    expect(read('src/app/download/page.tsx')).not.toMatch(/'Supported'|Coming soon/);
  });
});
