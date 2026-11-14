// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tells people about a paid order. We are told by email, by a chat webhook, or both, whichever is configured; the
 * buyer is told by email. A channel that is not configured is "off", not a failure, so nothing retries for ever.
 * No message and no address is ever logged.
 */
import { type MailConfig } from '../config/env';
import { type EmailBinding } from '../store/d1';
import { type Order } from '../store/d1-orders';
import { buyerMessage, ownerMessage, type Message } from './messages';

export type Told = 'sent' | 'failed' | 'off';

export interface Notifier {
  /** Tells us. `sent` when at least one channel took it. */
  owner(order: Order): Promise<Told>;
  /** Tells the buyer. */
  buyer(order: Order): Promise<Told>;
}

export interface NotifierOptions {
  email: EmailBinding | undefined;
  mail: MailConfig | null;
  webhookUrl: string | null;
  fetch: typeof fetch;
  /** The plan's name as people read it. */
  planLabel: (plan: string) => string;
}

const SENDER_NAME = 'Taalcut';
const WEBHOOK_TIMEOUT_MS = 8000;

export function createNotifier(options: NotifierOptions): Notifier {
  const { email, mail, webhookUrl } = options;

  async function sendEmail(to: string, body: Message, replyTo: string): Promise<boolean> {
    if (!email || !mail) return false;
    try {
      await email.send({ to, from: { email: mail.from, name: SENDER_NAME }, replyTo, ...body });
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'billing.email_failed',
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return false;
    }
  }

  async function sendWebhook(body: Message): Promise<boolean> {
    if (webhookUrl === null) return false;
    // The buyer typed part of this. With its brackets written as plain characters and mentions switched off,
    // it can't ping a channel or pose as a link, and an address in it can still be copied.
    const content = `${body.subject}\n\n${body.text}`
      .slice(0, 1900)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    try {
      const response = await options.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Chat services disagree on the field's name; each reads its own and ignores the other.
        body: JSON.stringify({ content, text: content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      // The chat service is away. The caller tries again on the next sweep.
      return false;
    }
  }

  return {
    async owner(order) {
      const canEmail = email !== undefined && mail !== null;
      if (!canEmail && webhookUrl === null) return 'off';
      const body = ownerMessage(order, options.planLabel(order.plan));
      const [byEmail, byWebhook] = await Promise.all([
        canEmail ? sendEmail(mail.ownerEmail, body, order.email) : false,
        sendWebhook(body),
      ]);
      return byEmail || byWebhook ? 'sent' : 'failed';
    },
    async buyer(order) {
      if (!email || !mail) return 'off';
      const body = buyerMessage(order, options.planLabel(order.plan), mail.ownerEmail);
      // In the provider's test mode a payment costs nothing, so an address typed into the form proves nothing:
      // the buyer's message goes to us instead, and no stranger is told they paid.
      const to = order.mode === 'test' ? mail.ownerEmail : order.email;
      return (await sendEmail(to, body, mail.ownerEmail)) ? 'sent' : 'failed';
    },
  };
}
