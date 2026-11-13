// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { SITE } from './site';

/**
 * /contact/ in words: the page is a direct-message thread with Taalcut, then the other ways to reach the team. For
 * the page, its .md mirror and engines. The form's own words (labels, errors, states) are CONTACT_WORDS in forms.ts.
 */

/** The quick replies at the top of the thread. `?topic=<id>` picks one when the page opens. */
export type ContactChipId = 'hello' | 'press' | 'privacy' | 'security' | 'broken';

export interface ContactChip {
  readonly id: ContactChipId;
  /** The chip, and your bubble once you pick it. */
  readonly label: string;
  /** Taalcut's answer to it. While the form is closed the answer also names the one address (SITE.email). */
  readonly reply: string;
}

export const CONTACT_CHIPS: readonly ContactChip[] = [
  {
    id: 'hello',
    label: 'Say hello',
    reply: 'Hello back! Ask anything, or tell us what you make.',
  },
  {
    id: 'press',
    label: 'Press',
    reply: 'Tell us who you write for and what you need. The name, logo and Kaatu are on the press page.',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    reply: `Ask us about your data here. The waitlist is closed; to delete an entry you made, write to ${SITE.email} from the address you joined with.`,
  },
  {
    id: 'security',
    label: 'Security',
    reply: `Thanks for looking. Tell us what you found and how to see it again. You can also write to ${SITE.email}.`,
  },
  {
    id: 'broken',
    label: 'Something’s broken',
    reply: 'Sorry about that. Tell us what you did, what you saw, and which computer you’re on.',
  },
];

export const CONTACT_PAGE = {
  /** The page's h1 and the line under it. */
  title: ['Write to us.', 'We write back.'],
  lead: 'Pick a topic and write a few lines, and a reply comes by email. Or write to the address below.',
  /** The thread's words, top to bottom. */
  thread: {
    heading: 'Message Taalcut',
    name: 'Taalcut',
    status: 'Usually replies by email',
    /** The question sticker that opens the thread; the topic chips answer it. */
    question: 'Ask Taalcut anything',
    hint: 'Pick a topic, or just start typing.',
    topics: 'Topics',
    /** Taalcut asks for your name and address, one question each; you answer each in one line. */
    askName: 'Who’s writing?',
    askEmail: 'And where should we reply?',
    /** What each one-line answer shows while it's empty. */
    replyHints: { name: 'Your name', email: 'you@example.com' },
    /** Under an answer you gave: opens it again. */
    change: 'Change',
    log: 'Your conversation with Taalcut',
  },
  waysHeading: 'Other ways',
  /** The one address, for everything: hello, press, your data and security reports. */
  mailbox: { address: SITE.email, line: 'Anything at all: press, your data, or a security problem.' },
  instagram: { title: 'Message us on', line: 'News, and direct messages.' },
  copy: {
    idle: 'Copy',
    done: 'Copied',
    /** When the browser won't copy, the address is selected instead, and this says how to finish. */
    selected: 'Selected',
    selectedHint: 'The address is selected. Press Command C or Control C to copy it.',
  },
} as const;
