// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FEATURE_GROUPS, FEATURES } from '#content/features';
import { LLMS } from '#content/llms';
import type { PageEntry } from '#content/schema';
import { SITE } from '#content/site';
import { absolute } from '#lib/seo';
import { doc, heading } from './markdown';
import { listedPages, mirrorPath } from './mirror';
import { pageMarkdown } from './pages-md';

/**
 * /llms.txt (the llms.txt convention: an H1, a quoted summary, a paragraph of facts, then H2 sections that list
 * files) and /llms-full.txt (every mirror in one file). Both come from PAGES and src/content. The feature pages are
 * grouped as /features/ groups them (FEATURE_GROUPS): the Features section lists the index, then each group is an H2
 * section of its own, in the index's order.
 */
export const LLMS_SECTIONS: readonly PageEntry['section'][] = ['Product', 'Features', 'Company', 'Legal'];

/** The feature group a page belongs to, by its path (`/features/<slug>/`); undefined for every other page. */
export function featureGroupOf(path: string): (typeof FEATURE_GROUPS)[number] | undefined {
  const slug = /^\/features\/([^/]+)\/$/.exec(path)?.[1];
  if (!slug) return undefined;
  return FEATURE_GROUPS.find((g) => FEATURES.some((f) => f.slug === slug && f.group === g.id));
}

/** The llms.txt sections in order, each with its listed pages: the Features section split into its groups. */
export function llmsSections(): readonly { readonly title: string; readonly pages: readonly PageEntry[] }[] {
  const pages = listedPages();
  return LLMS_SECTIONS.flatMap((section) => {
    const own = pages.filter((p) => p.section === section);
    if (section !== 'Features') return [{ title: section, pages: own }];
    return [
      { title: section, pages: own.filter((p) => !featureGroupOf(p.path)) },
      ...FEATURE_GROUPS.map((g) => ({ title: g.title, pages: own.filter((p) => featureGroupOf(p.path)?.id === g.id) })),
    ];
  });
}

export function llmsTxt(): string {
  return doc(
    heading(1, SITE.name),
    `> ${SITE.description}`,
    LLMS.facts,
    ...llmsSections().flatMap(({ title, pages }) => [
      heading(2, title),
      pages.map((p) => `- [${p.title}](${absolute(mirrorPath(p.path))}): ${p.description}`).join('\n'),
    ]),
    heading(2, 'Optional'),
    `- [Everything in one file](${absolute('/llms-full.txt')}): ${LLMS.optional}`,
  );
}

export function llmsFullTxt(): string {
  const pages = llmsSections().flatMap((s) => s.pages);
  return doc(
    heading(1, SITE.name),
    `> ${SITE.description}`,
    LLMS.fullIntro,
    LLMS.facts,
    // Each page's headings step down one level, so the file keeps one H1.
    ...pages.map((p) => `---\n\n${pageMarkdown(p).trimEnd().replace(/^(#{1,5}) /gm, '#$1 ')}`),
  );
}
