// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { SITE } from './site';

/**
 * /waitlist/ in words: what joining means, said once, for the page, its .md mirror and engines. The same facts as
 * website/firebase/DATA.md and the privacy page (the gate reconciles the three).
 */
export const WAITLIST_PAGE = {
  /** The page's h2 over the facts. */
  nextHeading: 'What happens next',
  facts: [
    ['You get', 'One email, when the beta first opens for a computer you picked. Joining doesn’t promise a date or a spot.'],
    [
      'We keep',
      'Your email, the computers you pick, what you make if you say, the page or section you joined from (a short ' +
        'tag such as home-hero or ig), the version of the consent line you agreed to, and the time you joined.',
    ],
    [
      'For how long',
      'Until 30 days after we send that one email, or until you ask us to delete it.',
    ],
    ['Leaving', `Write to ${SITE.email} from the same address and your entry is deleted.`],
    ['Price', 'Taalcut is free. It runs on your computer, with the AI you choose.'],
  ] satisfies readonly Fact[],
} as const;

/** The waitlist band that closes every page: its default line, the words under it, and its stickers' facts. */
export const WAITLIST_BAND = {
  heading: 'Make your first one when the beta opens.',
  lead: 'Taalcut is free. One email when it’s ready for your computer, and nothing else.',
  /** Each says what the lead says in words. */
  stickers: { email: 'One email', free: 'Free', mac: 'macOS', ubuntu: 'Ubuntu 24.04' },
} as const;
