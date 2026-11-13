// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The values the owner edits: the address, the accounts, the mail boxes. Everything else derives from these. */
export const SITE = {
  name: 'Taalcut',
  origin: 'https://taalcut.app',
  /** The one-line story (NAMING.md): said once, on About and in the footer. */
  story: 'Taal is the rhythm cycle in Indian music. Taalcut cuts your clips to the rhythm of a reel you love.',
  pronunciation: 'TAHL-cut',
  /** The site's one-sentence description: meta, OG, llms.txt, JSON-LD. */
  description:
    'Taalcut turns a reel you love into a template, then makes your version from your own camera roll. An AI video editor for creators that runs on your computer.',
  instagram: { handle: '@taalcut.app', url: 'https://www.instagram.com/taalcut.app/' },
  /** The one address for everything: hello, press, your data and security reports (the owner, 2026-11-06). */
  email: 'admin@matterwardlabs.com',
  /** The company that makes Taalcut and runs this site: the footer's credit, the legal pages and JSON-LD. */
  company: { legal: 'Matterward Labs Private Limited', name: 'Matterward Labs', url: 'https://matterwardlabs.com' },
  /** The code is AGPL-3.0-or-later; the repository opens with the beta (LICENCE_LINE says it). */
  licence: { name: 'AGPL-3.0-or-later', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  repository: 'https://github.com/satyajiit/taalcut',
  /** Until the owner confirms otherwise the site says the code "opens with the beta" (truth ledger). */
  repositoryPublic: false,
  /** The browser's chrome colour: the ground in each theme (globals.css --color-canvas). */
  themeColor: { light: '#ffffff', dark: '#08080a' },
} as const;

/** The licence, said one way everywhere (the footer, About, the FAQ, the terms). Never "is free software" today. */
export const LICENCE_LINE = `Taalcut is free. Its code is under the ${SITE.licence.name} licence and opens with the beta.`;

/** The policy the name and logo follow, named the same way wherever the site names it. */
export const TRADEMARK_POLICY = 'the Taalcut trademark policy';

/** The footer's © line, in the company's name (the owner, 2026-11-06). */
export const COPYRIGHT_LINE = `© 2026 ${SITE.company.legal}`;

/**
 * The footer's credit beside the © line: the company's mark and its words, linking to its site. `name` is the link's
 * accessible name: it starts with the words it shows (WCAG 2.5.3) and says where it goes.
 */
export const COMPANY_CREDIT = {
  label: `Made by ${SITE.company.name}`,
  name: `Made by ${SITE.company.name}, the company that makes Taalcut`,
} as const;

/**
 * The footer's analytics switch (lib/analytics): its words say what a click does, and the status line is what a screen
 * reader hears after one. /privacy/#by-default says the rest.
 */
export const ANALYTICS_SWITCH = {
  turnOff: 'Turn off analytics',
  turnOn: 'Turn on analytics',
  saidOff: 'Analytics is off. This browser sends no more visit counts.',
  saidOn: 'Analytics is on.',
} as const;

/** The footer's one line under the mark (the story's second sentence). */
export const FOOTER_LINE = 'Taalcut cuts your clips to the rhythm of a reel you love.';

/** The nav's three links; the chrome gives each its Lucide icon. The outlined Join link and the theme switch follow. */
export const NAV = [
  { href: '/features/', label: 'Features' },
  { href: '/ai/', label: 'Your AI' },
  { href: '/download/', label: 'Platforms' },
] as const;

/** The footer's link groups (each link with its icon in the chrome). */
export const FOOTER_GROUPS = [
  {
    heading: 'Taalcut',
    links: [
      { href: '/features/', label: 'Features' },
      { href: '/ai/', label: 'Your AI' },
      { href: '/download/', label: 'Platforms' },
      { href: '/faq/', label: 'FAQ' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about/', label: 'About' },
      { href: '/press/', label: 'Press' },
      { href: '/contact/', label: 'Contact' },
      { href: '/waitlist/', label: 'Waitlist' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/privacy/', label: 'Privacy' },
      { href: '/terms/', label: 'Terms' },
      { href: '/beta-terms/', label: 'Beta terms' },
    ],
  },
] as const;

/** Every footer link, in order (the pages test checks each has a route). */
export const FOOTER_LINKS: readonly (typeof FOOTER_GROUPS)[number]['links'][number][] = FOOTER_GROUPS.flatMap(
  (g): readonly (typeof FOOTER_GROUPS)[number]['links'][number][] => g.links,
);

/** The footer's platform row: each OS by its own name beside its SVGL icon. */
export const FOOTER_PLATFORMS = [
  { brand: 'apple', label: 'macOS, Apple silicon' },
  { brand: 'ubuntu', label: 'Ubuntu 24.04' },
  { brand: 'windows', label: 'Windows, after 1.0' },
] as const;
