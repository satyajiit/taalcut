// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the Worker asks of the payment provider: make a payment link, and read one back. The REST client and the
 * tests' fake both implement it.
 */

export type LinkStatus = 'created' | 'partially_paid' | 'paid' | 'expired' | 'cancelled';

export interface LinkPayment {
  id: string;
  status: string;
  /** Seconds since the epoch, as the provider reports it. */
  createdAt: number;
}

export interface ProviderLink {
  id: string;
  /** Our order id, as we sent it. */
  referenceId: string | null;
  status: LinkStatus;
  amount: number;
  amountPaid: number;
  currency: string;
  /** The page the buyer pays on. */
  url: string;
  payments: readonly LinkPayment[];
}

export interface NewLink {
  amount: number;
  currency: string;
  referenceId: string;
  description: string;
  /** All three: the provider makes no link without a name, an address and a phone number. */
  customer: { name: string; email: string; contact: string };
  /** Where the buyer's browser goes after paying. */
  returnUrl: string;
  /** Seconds since the epoch. The provider wants at least 15 minutes ahead. */
  expireBy: number;
  notes: Readonly<Record<string, string>>;
}

/**
 * `refused`: the provider answered and said no (our request or our key is wrong). `unreachable`: it did not
 * answer, or answered with a fault of its own. `not_found`: it has no such link.
 */
export type ProviderResult<T> =
  { ok: true; value: T } | { ok: false; reason: 'refused' | 'unreachable' | 'not_found' };

export interface PaymentProvider {
  createLink(input: NewLink): Promise<ProviderResult<ProviderLink>>;
  getLink(id: string): Promise<ProviderResult<ProviderLink>>;
}
