// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The provider's REST API: payment links only. Every answer is parsed before it is used. A refusal is logged with
 * the provider's own code, field and sentence, with the buyer's name and address taken out of the sentence in
 * case it quotes them, and is never sent to a visitor.
 */
import { z } from 'zod';

import { type ProviderKeys } from '../config/env';
import {
  type LinkStatus,
  type NewLink,
  type PaymentProvider,
  type ProviderLink,
  type ProviderResult,
} from './port';

const API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;
const STATUSES: readonly LinkStatus[] = ['created', 'partially_paid', 'paid', 'expired', 'cancelled'];

const linkSchema = z.object({
  id: z.string().regex(/^plink_[A-Za-z0-9]{6,40}$/),
  reference_id: z.string().nullish(),
  status: z.enum(STATUSES),
  amount: z.number().int().nonnegative(),
  amount_paid: z.number().int().nonnegative().nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  short_url: z.url(),
  payments: z
    .array(
      z.object({
        payment_id: z.string(),
        status: z.string(),
        created_at: z.number().int().nonnegative(),
      }),
    )
    .nullish(),
});

const refusalSchema = z.object({
  error: z.object({
    code: z.string().nullish(),
    description: z.string().nullish(),
    field: z.string().nullish(),
    reason: z.string().nullish(),
  }),
});

export interface RestProviderOptions {
  keys: ProviderKeys;
  fetch: typeof fetch;
}

export function createRestProvider(options: RestProviderOptions): PaymentProvider {
  const authorization = `Basic ${btoa(`${options.keys.keyId}:${options.keys.keySecret}`)}`;

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    /** The buyer's own words in this request, kept out of any log line. */
    hidden: readonly string[] = [],
  ): Promise<ProviderResult<ProviderLink>> {
    let response: Response;
    try {
      response = await options.fetch(`${API}${path}`, {
        method,
        headers: {
          authorization,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // No answer in time, or no connection: the caller treats both as the provider being away.
      return { ok: false, reason: 'unreachable' };
    }
    if (response.status === 404) return { ok: false, reason: 'not_found' };
    if (!response.ok) {
      const sentence = await logRefusal(method, path, response, hidden);
      if (response.status >= 500 || response.status === 429) return { ok: false, reason: 'unreachable' };
      // The provider refuses some phone numbers our own check lets through (one of repeated digits, for one), and
      // its sentence is the only place it says so. Checked live on 2026-11-14.
      const contact = response.status === 400 && /customer contact/i.test(sentence ?? '');
      return { ok: false, reason: contact ? 'contact' : 'refused' };
    }
    const parsed = linkSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      console.error(JSON.stringify({ event: 'billing.provider_unreadable', method, path: routeOf(path) }));
      return { ok: false, reason: 'unreachable' };
    }
    const link = parsed.data;
    return {
      ok: true,
      value: {
        id: link.id,
        referenceId: link.reference_id ?? null,
        status: link.status,
        amount: link.amount,
        amountPaid: link.amount_paid ?? 0,
        currency: link.currency,
        url: link.short_url,
        payments: (link.payments ?? []).map((payment) => ({
          id: payment.payment_id,
          status: payment.status,
          createdAt: payment.created_at,
        })),
      },
    };
  }

  return {
    createLink: (input: NewLink) =>
      call(
        'POST',
        '/payment_links',
        {
          amount: input.amount,
          currency: input.currency,
          accept_partial: false,
          reference_id: input.referenceId,
          description: input.description,
          customer: input.customer,
          // The buyer is sent straight to the link, so the provider has nothing to send them before they pay.
          // It also means an order form can't be used to make the provider email a stranger.
          notify: { sms: false, email: false },
          reminder_enable: false,
          callback_url: input.returnUrl,
          callback_method: 'get',
          expire_by: input.expireBy,
          notes: input.notes,
        },
        [input.customer.name, input.customer.email, input.customer.contact],
      ),
    getLink: (id: string) => call('GET', `/payment_links/${encodeURIComponent(id)}`),
  };
}

/** The path without the link's id: what a log line names. */
function routeOf(path: string): string {
  return path.startsWith('/payment_links/') ? '/payment_links/:id' : path;
}

/** The provider's sentence without the buyer's own words: a log line carries no name and no address. */
function withheld(sentence: string | null | undefined, hidden: readonly string[]): string | undefined {
  if (typeof sentence !== 'string') return undefined;
  let text = sentence;
  for (const value of hidden) if (value.length > 0) text = text.replaceAll(value, '[withheld]');
  return text.slice(0, 200);
}

/** Logs a refusal without the buyer's words, and returns the provider's own sentence for the caller to read. */
async function logRefusal(
  method: string,
  path: string,
  response: Response,
  hidden: readonly string[],
): Promise<string | undefined> {
  const refusal = refusalSchema.safeParse(await response.json().catch(() => undefined));
  const error = refusal.success ? refusal.data.error : undefined;
  console.error(
    JSON.stringify({
      event: 'billing.provider_refused',
      method,
      path: routeOf(path),
      status: response.status,
      code: error?.code ?? undefined,
      field: error?.field ?? undefined,
      reason: error?.reason ?? undefined,
      description: withheld(error?.description, hidden),
    }),
  );
  return error?.description ?? undefined;
}
