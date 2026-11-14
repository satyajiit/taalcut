// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two messages a paid order sends: one to us, so somebody starts the buyer's setup, and one to the buyer, so
 * they know the payment arrived and what happens next. The buyer's words follow the website's Premium terms.
 */
import { type Order } from '../store/d1-orders';

/** A plan is active this long after payment at the latest. The website and the terms say the same. */
export const ACTIVATION_DAYS = 7;
const DAY_MS = 86_400_000;

export function activateBy(paidAt: number): number {
  return paidAt + ACTIVATION_DAYS * DAY_MS;
}

export interface Message {
  subject: string;
  text: string;
  html: string;
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}

function day(at: number): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(at);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Plain paragraphs as HTML: each blank-line block a paragraph, line breaks kept. */
function asHtml(text: string): string {
  return text
    .split('\n\n')
    .map((block) => `<p>${escapeHtml(block).replaceAll('\n', '<br>')}</p>`)
    .join('\n');
}

function message(subject: string, text: string): Message {
  return { subject, text, html: asHtml(text) };
}

/** To us. Everything needed to write to the buyer and start their setup. */
export function ownerMessage(order: Order, planLabel: string): Message {
  const paidAt = order.paidAt ?? order.createdAt;
  const lines = [
    `${planLabel}: a paid order${order.mode === 'test' ? ' (TEST MODE, no money moved)' : ''}.`,
    '',
    `Name: ${order.name}`,
    `Email: ${order.email}`,
    `WhatsApp: ${order.whatsapp ?? 'not given'}`,
    `Channel: ${order.channel ?? 'not given'}`,
    `Country: ${order.country ?? 'unknown'}`,
    '',
    `Paid: ${money(order.amount, order.currency)}${order.offerId ? ` (offer ${order.offerId}; list ${money(order.listAmount, order.currency)})` : ''}`,
    `Paid on: ${new Date(paidAt).toISOString()}`,
    `Write to them by: the next business day`,
    `Active by: ${day(activateBy(paidAt))} (refund in full after that)`,
    '',
    `Order: ${order.id}`,
    `Payment link: ${order.linkId ?? 'none'}`,
    `Payment: ${order.paymentId ?? 'not reported'}`,
  ];
  return message(`${planLabel}: paid order ${order.id}`, lines.join('\n').replace(/\n\n+/g, '\n\n'));
}

/** To the buyer. `contact` is the one address they can write to. */
export function buyerMessage(order: Order, planLabel: string, contact: string): Message {
  const paidAt = order.paidAt ?? order.createdAt;
  const text = [
    `Hi ${order.name},`,
    `We have your payment of ${money(order.amount, order.currency)} for ${planLabel}. Thank you.`,
    [
      'What happens next:',
      '1. Within one business day we write to you to book your setup session.',
      '2. In that session, by screen share, we install Taalcut on your Mac and set it up with you.',
      `3. Your plan is active within ${ACTIVATION_DAYS} days of your payment, by ${day(activateBy(paidAt))}. Your paid month starts on the day it is active.`,
    ].join('\n'),
    'If your plan is not active by that day, we refund the payment in full.',
    `Reply to this email or write to ${contact} with any question.`,
    ['Matterward Labs Private Limited, the company that makes Taalcut', `Order ${order.id}`].join('\n'),
  ].join('\n\n');
  if (order.mode === 'test')
    return message(
      `[TEST] Your ${planLabel} payment is in`,
      `TEST MODE: no money moved. This is the message ${order.email} would get.\n\n${text}`,
    );
  return message(`Your ${planLabel} payment is in`, text);
}
