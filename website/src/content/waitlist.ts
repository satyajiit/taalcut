// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { SITE } from './site';

/**
 * The waitlist, closed. The site took sign-ups until the first release (November 2026) and takes none now:
 * /waitlist/ stays for the links that point at it and says where the download is. What it tells people who joined is
 * the promise they were given: one email, then deletion 30 days after it. The form's own word for the day of that
 * email was the app "opening"; the site now says Taalcut "is out", which is the same day (firebase/DATA.md keeps the
 * consent line as it was shown). The same facts are in
 * website/firebase/DATA.md and on the privacy page (content/legal.ts › waitlist); the three change together.
 */
export const WAITLIST_KEPT =
  'Your email address, the computers you picked, what you make if you said, the page you joined from, the version of the consent line you saw and the time you joined.';
export const WAITLIST_EMAIL =
  'One email, when Taalcut is first out for a computer you picked, or, if you picked none, when it is first out at all. It is out for the Mac now; Ubuntu and Windows have no download yet.';
export const WAITLIST_HOW_LONG = 'Until 30 days after we send that one email, or until you ask us to delete it.';
export const WAITLIST_LEAVING = `Write to ${SITE.email} from the address you joined with, and we delete your entry.`;

export const WAITLIST_PAGE = {
  lead: 'This site no longer takes sign-ups. What we promised the people who joined still holds.',
  stickers: { closed: 'Waitlist closed', free: 'Free', mac: 'Apple silicon Macs' },
  joinedHeading: 'If you joined the waitlist',
  facts: [
    ['You get', WAITLIST_EMAIL],
    ['We keep', WAITLIST_KEPT],
    ['For how long', WAITLIST_HOW_LONG],
    ['Leaving', WAITLIST_LEAVING],
  ] satisfies readonly Fact[],
  privacy: 'The privacy notice says the rest',
} as const;
