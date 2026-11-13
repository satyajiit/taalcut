// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { PlatformId } from '#content/schema';
import { SITE } from './site';
import type { WriteCause } from '#lib/firebase/outcome';
import type { Make } from '#stores/waitlist';

/**
 * The forms' words (waitlist and contact), shared by components/waitlist and components/contact. test/unit/waitlist-words.test.ts runs every one through the truth ledger.
 * Errors name the cause and one fix (DESIGN.md › Feedback).
 */

export const WAITLIST_WORDS = {
  emailLabel: 'Your email',
  placeholder: 'name@example.com',
  /** The inline form's hint, in the field, where its label is for assistive technology only. */
  inlineHint: 'Your email',
  submit: 'Join the waitlist',
  submitting: 'Joining…',
  consent: 'One email when the beta opens.',
  privacyLink: 'Privacy',
  platformsLegend: 'Which computer will you use?',
  platformsHint: 'Pick each one you use. Windows comes after 1.0.',
  makeLabel: 'What do you make?',
  makeOptional: 'Optional',
  makeNone: 'Pick one',
  success: 'You’re on the list.',
  closed: 'The waitlist opens soon.',
  follow: 'Follow',
  followTail: 'on Instagram for news.',
  noScript: 'Joining needs JavaScript. Turn it on, or follow @taalcut.app on Instagram for news.',
  /** Ends with the line's Try again, so it stays one line from 360 px (StatusLine). */
  offline: 'You’re offline. Nothing was sent.',
  tryAgain: 'Try again',
} as const;

/** The platform choices: the OS by its own name, and the line under it. */
export const PLATFORM_CHOICES: readonly {
  readonly id: PlatformId;
  readonly name: string;
  readonly line: string;
}[] = [
  { id: 'macos', name: 'macOS', line: 'Apple silicon, macOS 14 or later' },
  { id: 'ubuntu', name: 'Ubuntu', line: '24.04, x64' },
  { id: 'windows', name: 'Windows', line: 'After 1.0' },
];

export const MAKE_LABELS: Record<Make, string> = {
  travel: 'Travel',
  food: 'Food',
  product: 'Product',
  fitness: 'Fitness',
  'day-in-life': 'Day in the life',
  other: 'Something else',
};

/**
 * What's wrong with an address, from what was typed, and how to fix it. Each fits one line of a phone's field from
 * 360 px up, because the field's message slot holds one line and nothing under it may move.
 */
export function emailHint(raw: string, problem: 'empty' | 'too-long' | 'malformed'): string {
  const email = raw.trim();
  if (problem === 'empty') return 'Add your email, like name@example.com.';
  if (problem === 'too-long') return 'It’s over 254 characters. Check the paste.';
  if (/\s/.test(email)) return 'Take out the space. Addresses have none.';
  if (!email.includes('@')) return 'Add the @, like name@example.com.';
  if (email.indexOf('@') !== email.lastIndexOf('@')) return 'Keep one @. An address has only one.';
  if (email.startsWith('@')) return 'Add your name before the @.';
  if (email.includes('/')) return 'Take out the slash. Addresses have none.';
  return 'Add the part after the @, like example.com.';
}

/**
 * A failed send: the cause, then its one fix. Where trying again is the fix, the line ends with its Try again button
 * (`causeRetries`) and the words name only the cause; otherwise the words name the fix. `the` names what didn't answer
 * ("The list", "Our inbox"). Each, with its button, fits one line of a phone's form from 360 px up and two at 320 px,
 * because the slot under the field holds that much and nothing under it may move.
 */
export function causeWords(cause: WriteCause, the: 'The list' | 'Our inbox'): string {
  switch (cause) {
    case 'refused':
      return 'Our spam check stopped it. Reload the page.';
    case 'busy':
      return `${the} is busy right now.`;
    case 'timeout':
      return `${the} didn’t answer in time.`;
    case 'unreachable':
      return `We couldn’t reach ${the.toLowerCase()}.`;
    case 'load-failed':
      return 'Part of the page didn’t load.';
    case 'unknown':
      return `${the} couldn’t save that.`;
  }
}

/** Whether a failed send's fix is its Try again. A refusal needs the page reloaded, for a new spam check. */
export function causeRetries(cause: WriteCause): boolean {
  return cause !== 'refused';
}

export const CONTACT_WORDS = {
  nameLabel: 'Your name',
  emailLabel: 'Your email',
  messageLabel: 'Message',
  messageHint: 'Write your message',
  /** The send button: its words on screen, and its full name for assistive technology. */
  send: 'Send',
  submit: 'Send message',
  submitting: 'Sending…',
  /** The receipt under your bubble. */
  sending: 'Sending…',
  sent: 'Sent',
  success: 'Thanks, your message is in.',
  successLine: 'A reply comes by email, to',
  sendAnother: 'Write another',
  closed: 'This form opens with the waitlist. Until then, write to',
  closedTail: 'or message',
  closedEnd: 'on Instagram.',
  tryAgain: 'Try again',
  noScript: 'The form needs JavaScript. You can also write to the address on this page.',
  offline: 'You’re offline. Nothing was sent.',
  nameEmpty: 'Add your name, or what to call you.',
  nameLong: 'Keep your name under 80 characters.',
  messageEmpty: 'Write a message first.',
  messageLong: 'Over 2,000 characters. Send it in two.',
} as const;

export const INSTAGRAM = SITE.instagram;
