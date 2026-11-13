// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { FAQ } from '#content/faq';
import { BETA_TERMS } from '#content/legal';
import { PAGES } from '#content/pages';
import { PLATFORMS } from '#content/platforms';
import { DOWNLOAD_BAND, GET, INSTALL, KNOWN_LIMIT, RELEASE } from '#content/release';
import {
  FOOTER_GROUPS,
  FOOTER_PLATFORMS,
  FOOTER_SOURCE,
  LICENCE_LINE,
  NAV,
  NAV_GET,
  SITE,
} from '#content/site';
import { WAITLIST_PAGE } from '#content/waitlist';
import { faqPageJsonLd, organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from '#lib/jsonld';
import { llmsFullTxt, llmsTxt } from '#lib/llms/llms-txt';
import { listedPages } from '#lib/llms/mirror';
import { pageMarkdown } from '#lib/llms/pages-md';
import { filesUnder, proseLiterals, read } from './source-files';

/** The release on the site: one download, said one way, never called a stage, and no waitlist left to join. */

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the download’s words', () => {
  it('hold to the truth ledger', () => {
    const copy = strings([
      KNOWN_LIMIT,
      DOWNLOAD_BAND,
      GET,
      INSTALL,
      FOOTER_PLATFORMS,
      FOOTER_SOURCE,
      LICENCE_LINE,
      NAV_GET,
      WAITLIST_PAGE,
    ]);
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('name the version and what it needs from the release, never typed twice', () => {
    // A plain release number, and every address built from it.
    expect(RELEASE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(RELEASE.name).toBe(`Taalcut ${RELEASE.version}`);
    expect(RELEASE.file).toBe(`Taalcut-${RELEASE.version}-arm64.dmg`);
    expect(RELEASE.fileUrl).toBe(`${SITE.repository}/releases/download/v${RELEASE.version}/${RELEASE.file}`);
    // The button's address carries no version: the publisher's copy of the newest stable .dmg, under its fixed name.
    expect(RELEASE.download).toBe(
      `${SITE.repository}/releases/download/channel-stable/${RELEASE.downloadFile}`,
    );
    expect(RELEASE.download).not.toContain(RELEASE.version);
    expect(RELEASE.page).toBe(`${SITE.repository}/releases/tag/v${RELEASE.version}`);
    expect(RELEASE.latest).toBe(`${SITE.repository}/releases/latest`);
    expect(GET.note).toBe(`${RELEASE.name} · Free · Apple silicon, macOS 14 or later`);
    expect(DOWNLOAD_BAND.lead).toContain(RELEASE.name);
    expect(INSTALL.steps).toHaveLength(3);
    expect(INSTALL.steps[0].body).toContain(RELEASE.downloadFile);
    expect(strings(INSTALL.facts).join(' ')).toContain(`[${RELEASE.file}](${RELEASE.fileUrl})`);
    // The requirements the note sums up are the Mac's own.
    const mac = Object.fromEntries(PLATFORMS.find((p) => p.id === 'macos')!.requirements);
    expect(RELEASE.system).toBe('macOS 14 or later');
    expect(mac.System).toMatch(/^macOS 14 \w+ or later$/);
    expect(mac.Chip).toContain(RELEASE.chip);
    // Outside the release module, no source file types the version, the tag or the file's name.
    const typed = filesUnder('src', ['.ts', '.tsx']).filter(
      (f) =>
        f !== 'src/content/release.ts' &&
        (read(f).includes(RELEASE.version) ||
          /Taalcut-(\d|mac)|channel-stable|releases\/(download|tag|latest)\b/.test(read(f))),
    );
    expect(typed).toEqual([]);
  });

  it('say the on-device limit plainly, with no number but the Mac’s memory', () => {
    expect(KNOWN_LIMIT).toMatch(/24 GB of memory/);
    expect(KNOWN_LIMIT).toMatch(/often doesn’t finish a make by itself/);
    expect(KNOWN_LIMIT).toMatch(/finish the video in the editor/);
    expect(KNOWN_LIMIT.replace('24 GB', '')).not.toMatch(/\d/);
    // It is beside the download: on /download/'s facts, and in the FAQ's answer to "When can I use it?".
    expect(strings(INSTALL.facts)).toContain(KNOWN_LIMIT);
    expect(FAQ.find((e) => e.id === 'when')!.answer).toContain(KNOWN_LIMIT);
  });

  it('promise nothing the release does not have, and no hype in a stage’s place', () => {
    const copy = strings([KNOWN_LIMIT, DOWNLOAD_BAND, GET, INSTALL, WAITLIST_PAGE]).join(' ');
    expect(copy).not.toMatch(
      /\b(paid|pricing|credits?|auto[- ]?updat\w*|updates? (itself|automatically))\b/i,
    );
    expect(copy).not.toMatch(/\b(v1|stable|production[- ]ready|beta|pre-?release)\b/i);
    expect(strings([DOWNLOAD_BAND, GET, INSTALL]).join(' ')).not.toMatch(
      /\.deb\b|\b(linux|ubuntu|windows)\b/i,
    );
  });
});

describe('the ways to the download and to GitHub', () => {
  it('are the nav’s outlined link and the footer’s, with no way to a waitlist', () => {
    expect(NAV_GET).toEqual({ href: '/download/', label: 'Download' });
    const links = [...NAV, ...FOOTER_GROUPS.flatMap((g) => [...g.links])];
    expect(links.map((l) => l.href)).not.toContain('/waitlist/');
    expect(links.find((l) => l.href === '/download/')?.label).toBe('Download');
    expect(SITE.repository).toBe('https://github.com/satyajiit/taalcut');
    expect(SITE).not.toHaveProperty('repositoryPublic');
  });

  it('leave no form, store or sender for the waitlist in the source', () => {
    const files = filesUnder('src', ['.ts', '.tsx']);
    expect(
      files.filter((f) => f.startsWith('src/components/waitlist/') || f === 'src/stores/waitlist.ts'),
    ).toEqual([]);
    const page = read('src/app/waitlist/page.tsx');
    expect(page).not.toMatch(/<form|<input|firebase/);
    expect(page).toContain('<GetButtons');
    for (const f of ['src/lib/firebase/load.ts', 'src/lib/firebase/sdk.ts'])
      expect(read(f), f).not.toMatch(/waitlist/i);
    // Only the pages registry, the closed page and its social card hold the address as a value: nothing links to it.
    const holding = files.filter((f) => /['"`]\/waitlist\/[^'"`]*['"`]/.test(read(f)));
    expect(holding.sort()).toEqual([
      'src/app/waitlist/opengraph-image.tsx',
      'src/app/waitlist/page.tsx',
      'src/content/pages.ts',
      'src/lib/og/card.ts',
    ]);
  });
});

/**
 * The owner, 2026-11-14: what you download is a release, never "the beta". The word stays for one thing, the app's
 * opt-in Beta update channel, whose three lines the app links to at /beta-terms/.
 */
describe('the word "beta"', () => {
  /** The channel's own words: the page, its name in the footer and the pages registry, and the app's strings on it. */
  const CHANNEL =
    /Beta (update )?channel|Stable and Beta|(switch to|choose) Beta|^Beta gets|the beta in three lines|Read the beta terms|\/beta-terms\//;
  /** Where source may say it: the channel's terms and the three things that name or link their page. */
  const HOLDERS = [
    'src/app/beta-terms/opengraph-image.tsx',
    'src/app/beta-terms/page.tsx',
    'src/content/legal.ts',
    'src/content/pages.ts',
    'src/content/site.ts',
  ];
  const sentences = (text: string) => text.split(/(?<=[.:])\s+|\n/).filter((part) => /beta/i.test(part));

  it('is said in the source only where it means the app’s update channel', () => {
    const files = [
      ...filesUnder('src/app', ['.tsx', '.ts']),
      ...filesUnder('src/components', ['.tsx', '.ts']),
      ...filesUnder('src/content', ['.ts']),
      ...filesUnder('src/lib', ['.ts', '.tsx']),
    ].filter((f) => !f.endsWith('media.gen.ts') && !f.endsWith('claims.ts'));
    const said = files.flatMap((file) =>
      proseLiterals(read(file))
        .flatMap(sentences)
        .map((text) => ({ file, text })),
    );
    expect(said.filter(({ file }) => !HOLDERS.includes(file))).toEqual([]);
    expect(said.filter(({ text }) => !CHANNEL.test(text))).toEqual([]);
    // The page says whose terms they are, and the app's three lines are its own.
    expect(BETA_TERMS.definition).toMatch(/^The Taalcut app has two update channels, Stable and Beta\./);
    expect(BETA_TERMS.lines).toHaveLength(3);
    expect(strings(BETA_TERMS).flatMap(claimViolations)).toEqual([]);
  });

  it('means the channel in what engines read too, and the release is never a stage there', () => {
    const machine = [
      llmsTxt(),
      llmsFullTxt(),
      ...listedPages().map(pageMarkdown),
      ...PAGES.map((p) => `${p.title}\n${p.description}`),
      JSON.stringify([organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd(), faqPageJsonLd()]),
    ];
    const said = machine.flatMap(sentences);
    expect(said.filter((text) => !CHANNEL.test(text))).toEqual([]);
    expect(softwareApplicationJsonLd().softwareVersion).toBe(RELEASE.version);
    // Only the channel's own page is titled for it; no other page's title or description has the word.
    expect(PAGES.filter((p) => /beta/i.test(`${p.title} ${p.description}`)).map((p) => p.path)).toEqual([
      '/beta-terms/',
    ]);
  });
});
