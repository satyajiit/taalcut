// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  type LinkStatus,
  type NewLink,
  type PaymentProvider,
  type ProviderLink,
  type ProviderResult,
} from '../src/razorpay/port';

interface StoredLink extends ProviderLink {
  payments: { id: string; status: string; createdAt: number }[];
}

/**
 * The payment provider, in memory. It keeps the links it was asked to make and lets a test play the buyer (pay),
 * time (expire), us in the dashboard (cancel) and an attacker or a bug (rewrite). `away` makes it stop answering.
 */
export class FakeProvider implements PaymentProvider {
  readonly created: NewLink[] = [];
  /** How many times a link was read back. */
  reads = 0;
  away = false;
  refuse = false;
  /** It will not take the buyer's phone number. */
  refuseContact = false;
  private readonly links = new Map<string, StoredLink>();
  private count = 0;
  private gate: Promise<void> | undefined;

  constructor(private readonly now: () => number) {}

  async createLink(input: NewLink): Promise<ProviderResult<ProviderLink>> {
    if (this.away) return { ok: false, reason: 'unreachable' };
    if (this.refuse) return { ok: false, reason: 'refused' };
    if (this.refuseContact) return { ok: false, reason: 'contact' };
    this.count += 1;
    const id = `plink_Test${String(this.count).padStart(6, '0')}`;
    const link: StoredLink = {
      id,
      referenceId: input.referenceId,
      status: 'created',
      amount: input.amount,
      amountPaid: 0,
      currency: input.currency,
      url: `https://rzp.io/i/${id}`,
      payments: [],
    };
    this.created.push(input);
    this.links.set(id, link);
    return { ok: true, value: link };
  }

  async getLink(id: string): Promise<ProviderResult<ProviderLink>> {
    this.reads += 1;
    if (this.gate) await this.gate;
    if (this.away) return { ok: false, reason: 'unreachable' };
    const link = this.links.get(id);
    return link
      ? { ok: true, value: { ...link, payments: [...link.payments] } }
      : { ok: false, reason: 'not_found' };
  }

  /** Holds every read that starts from now on. The returned function lets them all go at once. */
  hold(): () => void {
    let release: () => void = () => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = undefined;
      release();
    };
  }

  /** The provider no longer knows the link. */
  forget(id: string): void {
    this.links.delete(id);
  }

  /** The buyer pays the link in full. Returns the payment's id. */
  pay(id: string): string {
    const link = this.stored(id);
    const paymentId = `pay_Test${String(link.payments.length + 1).padStart(6, '0')}${id.slice(-4)}`;
    link.status = 'paid';
    link.amountPaid = link.amount;
    link.payments.push({ id: paymentId, status: 'captured', createdAt: Math.floor(this.now() / 1000) });
    return paymentId;
  }

  close(id: string, status: Extract<LinkStatus, 'expired' | 'cancelled'>): void {
    this.stored(id).status = status;
  }

  /** Changes what the provider's record says, as a tampered or mistaken link would. */
  rewrite(
    id: string,
    change: Partial<Pick<StoredLink, 'amount' | 'amountPaid' | 'currency' | 'referenceId' | 'status'>>,
  ): void {
    Object.assign(this.stored(id), change);
  }

  private stored(id: string): StoredLink {
    const link = this.links.get(id);
    if (!link) throw new Error(`no link ${id}`);
    return link;
  }
}
