// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { SITE } from './site';
import type { WriteCause } from '#lib/firebase/outcome';

/**
 * The contact form's words (components/contact). test/unit/form-words.test.ts runs every one through the truth ledger.
 * Errors name the cause and one fix (DESIGN.md › Feedback).
 */

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
 * ("Our inbox"). Each, with its button, fits one line of a phone's form from 360 px up and two at 320 px,
 * because the slot under the field holds that much and nothing under it may move.
 */
export function causeWords(cause: WriteCause, the: 'Our inbox'): string {
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
  closed: 'This form is closed right now. Write to',
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
