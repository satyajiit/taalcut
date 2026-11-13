// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { LICENCE_LINE, SITE, TRADEMARK_POLICY } from './site';

/**
 * The privacy notice, the site's terms and the beta terms, in plain language, for counsel's review (H6). They describe
 * only what the site does: visit analytics (Firebase Analytics, on for everyone with a remembered opt-out, the owner's
 * call on 2026-11-06; lib/analytics), its two cookies, every browser storage key by name and when it is written, and
 * the waitlist and contact entries in Firestore behind App Check. The facts are website/firebase/DATA.md's, checked in
 * a browser on 2026-11-06: the cookies `_ga` and `_ga_<id>`, and the installations and heartbeat IndexedDB records.
 * Visitor text names no product (claims.ts › STACK_NAMES). Text may carry links as `[label](href)`.
 */

export type LegalBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'facts'; readonly facts: readonly Fact[] };

export interface LegalSection {
  /** The section's anchor (`/privacy/#waitlist`). */
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDoc {
  /** The visible line at the top: when it last changed. */
  readonly status: string;
  /** The answer-first sentence the page opens with. */
  readonly definition: string;
  readonly sections: readonly LegalSection[];
}

/** When the notices last changed, shown on each page and in the .md mirrors. */
export const LEGAL_UPDATED = { iso: '2026-11-06', words: '6 November 2026' } as const;
/** The privacy notice's own date: it changed on 2026-11-07 for the launch film; the terms keep LEGAL_UPDATED. */
export const PRIVACY_UPDATED = { iso: '2026-11-07', words: '7 November 2026' } as const;

/** The one address, as a link. */
const mail = `[${SITE.email}](mailto:${SITE.email})`;
/** The company that makes Taalcut and runs this site, as a link to its own. */
const company = `[${SITE.company.legal}](${SITE.company.url})`;
const p = (text: string): LegalBlock => ({ kind: 'p', text });

/** One row of the privacy notice's gist: its facts, said short, each from a section below (the icon is the section's). */
export interface GistRow {
  /** The section the row sums up, so the row links to it. */
  readonly section: string;
  readonly text: string;
}

/** The gist at the top of /privacy/: the notice in six short lines, nothing it doesn't say in full below. */
export const PRIVACY_GIST: { readonly heading: string; readonly rows: readonly GistRow[] } = {
  heading: 'The gist',
  rows: [
    { section: 'by-default', text: 'An analytics service counts visits, with two cookies. Turn it off at the foot of any page.' },
    { section: 'by-default', text: 'The site’s own settings stay in your browser: your theme, the logo’s count-in and your analytics choice.' },
    { section: 'after-sending', text: 'Sending a form adds a bot check, run by our cloud provider.' },
    { section: 'film', text: 'The launch film on the home page plays from YouTube, and only once you press play.' },
    { section: 'waitlist', text: 'The waitlist keeps your email to send one email when the beta opens, and deletes it 30 days after that.' },
    { section: 'contact-form', text: 'A message from the contact form is kept for 12 months.' },
    { section: 'rights', text: `Write to ${SITE.email} to see, correct or delete what we hold.` },
  ],
};

export const PRIVACY: LegalDoc = {
  status: `Last updated ${PRIVACY_UPDATED.words}.`,
  definition:
    'This notice says what taalcut.app and its waitlist collect, why, how long it is kept and how to have it deleted. By default, the website counts visits, and you can turn that off at the foot of any page.',
  sections: [
    {
      id: 'who',
      heading: 'Who runs this site',
      blocks: [
        p(`${company} makes Taalcut and runs taalcut.app. It decides what happens to your data here. For anything about your data, write to ${mail}.`),
      ],
    },
    {
      id: 'by-default',
      heading: 'What the website collects by default',
      blocks: [
        p('Visit counts. An analytics service run by our cloud provider counts how the site is used, so we can see what works and fix what doesn’t. It starts a moment after a page loads, and records:'),
        {
          kind: 'list',
          items: [
            'the pages you open, their titles, and the page or link that brought you here, with any campaign tag in it;',
            'your device type, operating system, browser, screen size and language;',
            'your approximate location, such as your city and country, which the service works out from your IP address without keeping the address;',
            'how you use a page: how far you scroll, the links you follow to other sites, and how long you stay;',
            'that you joined the waitlist or sent a message, with the page you joined from or the message’s topic, but never your address or what you wrote.',
          ],
        },
        p('It sets two cookies on this site, `_ga` and one whose name starts with `_ga_`. They hold a random number that tells a returning visit from a new one, and last up to two years. It also keeps two small records in your browser’s storage (IndexedDB): another random number for this browser, and the days the provider’s tools were used on this site.'),
        p('We see the counts as totals and trends. Advertising features are off, nothing is shared for advertising, and the counts are never joined to your waitlist entry or your message. The service keeps them for up to 14 months. Our basis is our legitimate interest in knowing how the site is used, so we can improve it.'),
        p('To stop it, choose “Turn off analytics” at the foot of any page. The site remembers your choice, deletes the two cookies at once and sends no more counts; clearing this site’s data in your browser removes the rest. If your browser sends a Global Privacy Control or Do Not Track signal, analytics stays off unless you turn it on there.'),
        p('The site also keeps three small settings of its own in your browser’s storage. They never leave your device:'),
        {
          kind: 'list',
          items: [
            '`taalcut.theme`, in local storage: the light or dark theme, written when you choose one;',
            '`taalcut.countedIn`, in session storage: that the logo has played its count-in, written the first time it plays, so it doesn’t play again until you close the tab;',
            '`taalcut.analytics`, in local storage: “off” or “on”, written when you use the analytics switch at the foot of a page.',
          ],
        },
      ],
    },
    {
      id: 'after-sending',
      heading: 'After you send a form',
      blocks: [
        p('Sending a form also runs a bot check by our cloud provider. From then on, small records stay in your browser’s storage (IndexedDB):'),
        {
          kind: 'list',
          items: [
            'one that shows the form passed the bot check;',
            'the record of the days the provider’s tools were used on this site, if analytics hasn’t made it already. The bot check sends it to our cloud provider with its request.',
          ],
        },
        p('The bot check may write its own storage too. None of these is a cookie of the site’s, and the site never reads them for anything else.'),
      ],
    },
    {
      id: 'film',
      heading: 'The launch film',
      blocks: [
        p('The home page shows our launch film from YouTube, in its privacy-enhanced mode. Until you press play, the page loads nothing from YouTube: the cover image is served by this site.'),
        p('When you press play, YouTube receives what every browser sends with a request, such as your IP address, and may keep data in your browser to play the video. YouTube’s own privacy policy covers that.'),
      ],
    },
    {
      id: 'waitlist',
      heading: 'The waitlist',
      blocks: [
        {
          kind: 'facts',
          facts: [
            ['What we keep', 'Your email address; the platforms you picked (none is ticked unless the link you followed picks one); what you make, if you say; the page or section you joined from, as a short tag such as “home-hero” or “ig”; the version of the consent line you saw; and the time you joined.'],
            ['Why', 'To send you one email, when the beta first opens for a computer you picked (or, if you picked none, when it first opens).'],
            ['Our basis', 'Your consent, given when you join.'],
            ['How long', 'Until 30 days after we send that one email, or until you ask us to delete it, whichever comes first.'],
            ['Leaving', `Write to ${mail} from the address you joined with, and we delete the entry.`],
          ],
        },
      ],
    },
    {
      id: 'contact-form',
      heading: 'The contact form',
      blocks: [
        {
          kind: 'facts',
          facts: [
            ['What we keep', 'Your name, your email address, the topic you chose, your message and the time you sent it.'],
            ['Why', 'To reply to you.'],
            ['Our basis', 'Our legitimate interest in replying to you, since you wrote to us.'],
            ['How long', '12 months, then it is deleted.'],
            ['Deleting it sooner', `Write to ${mail}.`],
          ],
        },
      ],
    },
    {
      id: 'processors',
      heading: 'Who handles it for us',
      blocks: [
        p('Our cloud provider stores the waitlist and contact entries and serves this website. Like any web host, it receives what every browser sends with a request, such as your IP address.'),
        p('Our cloud provider also runs the analytics service, which handles the visit counts for us as the section above describes.'),
        p('When you send a form, a bot check run by our cloud provider reads signals from your device and browser to tell that a person is sending it. It may keep its own data in your browser and on the provider’s own sites.'),
        p('Our cloud provider’s own privacy policy and terms apply to all three, and the bot check’s badge links to them.'),
      ],
    },
    {
      id: 'where',
      heading: 'Where it is stored',
      blocks: [
        p('The waitlist and contact entries are on our cloud provider’s servers in Mumbai, India. The visit counts are on the analytics service’s servers, which may be outside India, including in the United States.'),
      ],
    },
    {
      id: 'rights',
      heading: 'Your rights',
      blocks: [
        p(`Write to ${mail} and you can:`),
        {
          kind: 'list',
          items: [
            'see what we hold about you;',
            'correct it;',
            'have it deleted;',
            'object to how we use it, or withdraw your consent at any time;',
            'complain to your data-protection authority.',
          ],
        },
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [p(`This site and the waitlist are not meant for anyone under 16. If you think a child has joined, write to ${mail} and we delete the entry.`)],
    },
    {
      id: 'the-app',
      heading: 'The Taalcut app',
      blocks: [
        p('The app is separate from this website, and local-first. It indexes your footage on your computer, and your footage stays there unless you connect a cloud model. [How the app handles your footage](/faq/#footage-leaves).'),
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this notice',
      blocks: [p('When this notice changes, the date at the top changes with it.')],
    },
  ],
};

export const TERMS: LegalDoc = {
  status: `Last updated ${LEGAL_UPDATED.words}.`,
  definition:
    'These terms cover using taalcut.app and joining the waitlist. The Taalcut app comes with its own terms when the beta opens.',
  sections: [
    {
      id: 'who',
      heading: 'Who you agree with',
      blocks: [p(`These terms are between you and ${company}, the company that makes Taalcut and runs this site.`)],
    },
    {
      id: 'using',
      heading: 'Using this site',
      blocks: [
        p('You may read, link to and share the pages on this site. Please don’t attack it, overload it or work around its protections, and don’t use its forms to send spam or someone else’s details.'),
      ],
    },
    {
      id: 'waitlist',
      heading: 'The waitlist',
      blocks: [
        p(`Joining the waitlist doesn’t promise you a place in the beta, or a date. We send one email, when the beta first opens for a computer you picked. You can leave at any time by writing to ${mail}.`),
      ],
    },
    {
      id: 'no-warranty',
      heading: 'No warranty',
      blocks: [
        p(`The site and everything on it are provided as they are, without any warranty. It describes a product that is still being built, and details can change before release. As far as the law allows, ${SITE.company.legal} is not liable for losses that come from using this site.`),
      ],
    },
    {
      id: 'licences',
      heading: 'Content and code',
      blocks: [
        p(`${LICENCE_LINE} That covers this website’s code too: the [GNU Affero General Public License, version 3 or later](${SITE.licence.url}).`),
        p(`The name Taalcut and its logo are not covered by that licence. They follow ${TRADEMARK_POLICY}, and the [press kit](/press/) says how to use them when you write about Taalcut.`),
        p('Other companies’ names and logos belong to them. They appear here only to name the services Taalcut works with.'),
      ],
    },
    {
      id: 'links',
      heading: 'Links to other sites',
      blocks: [p('This site links to sites we don’t run, such as Instagram and OpenAI. Their own terms and privacy policies apply there.')],
    },
    {
      id: 'changes',
      heading: 'Changes',
      blocks: [p('We may update these terms. The date at the top says when they last changed.')],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [p(`Write to ${mail}, or use the [contact form](/contact/).`)],
    },
    {
      id: 'law',
      heading: 'Governing law',
      blocks: [p('To be confirmed.')],
    },
  ],
};

/**
 * The app's three beta lines, as written in its catalogue (apps/renderer/src/features/terms/beta-terms.tsx:
 * onboarding.beta.line1..3). The app shows them before you switch to the beta channel and links here.
 */
export const BETA_TERMS = {
  definition:
    'The Taalcut app shows these three lines before you switch to the beta channel. The full beta terms are published on this page before the beta opens.',
  lines: [
    'Things can still break. Your clips stay on this Mac.',
    'Updates come often, and install when you restart.',
    'Sharing usage counts and crash reports is up to you. Both start off.',
  ],
  ubuntuNote: 'On Ubuntu, the first line says “this computer”.',
  where: 'You see them on the beta step of first run, and in Settings › About before you switch channels.',
  who: `${company} makes Taalcut and runs this site.`,
  questions: `Questions about the beta: ${mail}.`,
} as const;
