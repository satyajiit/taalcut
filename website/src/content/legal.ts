// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { LICENCE_LINE, SITE, TRADEMARK_POLICY } from './site';

/**
 * The privacy notice, the site's terms and the Beta channel terms, in plain language, for counsel's review (H6). The
 * notice describes only what the site does: visit analytics (Firebase Analytics, on for everyone with a remembered opt-out, the owner's
 * call on 2026-11-06; lib/analytics), its two cookies, every browser storage key by name and when it is written, and
 * the contact messages in Firestore behind App Check, and the entries the waitlist took before it closed with the first
 * release (November 2026; content/waitlist.ts). The facts are website/firebase/DATA.md's, checked in
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

/** When the notices last changed, shown on each page and in the .md mirrors: the waitlist closed with the first release. */
export const LEGAL_UPDATED = { iso: '2026-11-14', words: '14 November 2026' } as const;
/** The privacy notice's own date (it has changed apart from the terms before: 2026-11-07, for the launch film). */
export const PRIVACY_UPDATED = LEGAL_UPDATED;

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

/** The gist at the top of /privacy/: the notice in seven short lines, nothing it doesn't say in full below. */
export const PRIVACY_GIST: { readonly heading: string; readonly rows: readonly GistRow[] } = {
  heading: 'The gist',
  rows: [
    { section: 'by-default', text: 'An analytics service counts visits, with two cookies. Turn it off at the foot of any page.' },
    { section: 'by-default', text: 'The site’s own settings stay in your browser: your theme, the logo’s count-in and your analytics choice.' },
    { section: 'after-sending', text: 'Sending the contact form adds a bot check, run by our cloud provider.' },
    { section: 'film', text: 'The launch film on the home page plays from YouTube, and only once you press play.' },
    { section: 'waitlist', text: 'The waitlist is closed. An address already on it is kept for one email, and deleted 30 days after that.' },
    { section: 'contact-form', text: 'A message from the contact form is kept for 12 months.' },
    { section: 'rights', text: `Write to ${SITE.email} to see, correct or delete what we hold.` },
  ],
};

export const PRIVACY: LegalDoc = {
  status: `Last updated ${PRIVACY_UPDATED.words}.`,
  definition:
    'This notice says what taalcut.app collects, what its closed waitlist still holds, why, how long it is kept and how to have it deleted. By default, the website counts visits, and you can turn that off at the foot of any page.',
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
            'that you sent a message, with the message’s topic, but never your address or what you wrote. While the waitlist was open, it also counted each sign-up by the page it came from, never by the address.',
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
      heading: 'After you send the contact form',
      blocks: [
        p('Sending the contact form also runs a bot check by our cloud provider. From then on, small records stay in your browser’s storage (IndexedDB):'),
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
      heading: 'The waitlist, now closed',
      blocks: [
        p('The waitlist closed in November 2026, when Taalcut first came out. This site no longer asks for your email address and adds nothing to the list. If you joined before then, this is what we hold and what happens to it:'),
        {
          kind: 'facts',
          facts: [
            ['What we keep', 'Your email address; the platforms you picked; what you make, if you said; the page or section you joined from, as a short tag such as “home-hero” or “ig”; the version of the consent line you saw; and the time you joined.'],
            ['Why', 'To send you one email, when Taalcut is first out for a computer you picked (or, if you picked none, when it is first out at all). It is out for the Mac now; Ubuntu and Windows have no download yet.'],
            ['Our basis', 'Your consent, given when you joined.'],
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
        p('Our cloud provider stores the contact messages and the waitlist’s remaining entries, and serves this website. Like any web host, it receives what every browser sends with a request, such as your IP address.'),
        p('Our cloud provider also runs the analytics service, which handles the visit counts for us as the section above describes.'),
        p('When you send the contact form, a bot check run by our cloud provider reads signals from your device and browser to tell that a person is sending it. It may keep its own data in your browser and on the provider’s own sites.'),
        p('Our cloud provider’s own privacy policy and terms apply to all three, and the bot check’s badge links to them.'),
        p('The Download and GitHub links go to GitHub, which hosts Taalcut’s code and the file you download. GitHub’s own privacy statement covers what it receives when you follow them.'),
      ],
    },
    {
      id: 'where',
      heading: 'Where it is stored',
      blocks: [
        p('The contact messages and the waitlist’s remaining entries are on our cloud provider’s servers in Mumbai, India. The visit counts are on the analytics service’s servers, which may be outside India, including in the United States.'),
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
      blocks: [p(`This site is not meant for anyone under 16. If you think a child joined the waitlist or sent us a message, write to ${mail} and we delete it.`)],
    },
    {
      id: 'the-app',
      heading: 'The Taalcut app',
      blocks: [
        p('The app is separate from this website, and local-first. The download itself comes from GitHub, so this site learns nothing from it beyond the visit counts above. It indexes your footage on your computer, and your footage stays there unless you connect a cloud model. [How the app handles your footage](/faq/#footage-leaves).'),
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
    'These terms cover using taalcut.app. The Taalcut app you download from it comes under its own licence.',
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
        p('You may read, link to and share the pages on this site. Please don’t attack it, overload it or work around its protections, and don’t use its contact form to send spam or someone else’s details.'),
      ],
    },
    {
      id: 'waitlist',
      heading: 'The waitlist, now closed',
      blocks: [
        p(`The waitlist closed when Taalcut first came out, and this site takes no new sign-ups. If you joined before then, what we said still holds: we send you one email, when Taalcut is first out for a computer you picked, and joining promised no date. You can leave at any time by writing to ${mail}.`),
      ],
    },
    {
      id: 'the-app',
      heading: 'The Taalcut app',
      blocks: [
        p('The Taalcut app is a separate download, and free. The file comes from GitHub under the licence named under “Content and code” below, which gives no warranty.'),
        p('The app has two update channels, Stable and Beta. Before you switch to Beta, it shows you three lines about what that means. The [Beta channel terms](/beta-terms/) have them.'),
      ],
    },
    {
      id: 'no-warranty',
      heading: 'No warranty',
      blocks: [
        p(`The site and everything on it are provided as they are, without any warranty. It describes a product that is still being built, and details can change. As far as the law allows, ${SITE.company.legal} is not liable for losses that come from using this site.`),
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
      blocks: [p('This site links to sites we don’t run, such as GitHub, Instagram and OpenAI. Their own terms and privacy policies apply there.')],
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
 * The Beta channel terms. The released app has two update channels, Stable and Beta (Settings › General › Updates).
 * Choosing Beta opens three plain lines, as written in the app's catalogue (apps/renderer/src/locales/en/messages.po:
 * onboarding.beta.line1..3, and line1.computer off a Mac), with "Read the beta terms", which opens this page. On this
 * site "beta" means that channel and nothing else: what you download is the release (content/release.ts).
 */
export const BETA_TERMS = {
  definition:
    'The Taalcut app has two update channels, Stable and Beta. Stable is the tested releases. Beta gets new things first, and more often, and things can still break. The app shows these three lines before you switch to Beta.',
  lines: [
    'Things can still break. Your clips stay on this Mac.',
    'Updates come often, and install when you restart.',
    'Sharing usage counts and crash reports is up to you. Both start off.',
  ],
  /** The window on the page: the app's own words where the lines appear. */
  window: {
    place: 'Settings › General › Updates',
    heading: 'Before you switch, the beta in three lines:',
    read: 'Read the beta terms',
    agree: 'Agree and switch to Beta',
  },
  ubuntuNote: 'Taalcut has no Ubuntu download yet. Built from source there, the first line says “this computer”.',
  where: 'In Settings › General › Updates, when you choose Beta and before the switch.',
  who: `${company} makes Taalcut and runs this site.`,
  questions: `Questions about the Beta channel: ${mail}.`,
} as const;
