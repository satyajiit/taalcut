// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What is sold and for how much: the `CATALOG` variable in wrangler.jsonc. A price or an offer changes there and
 * nowhere in the code. Amounts are minor units (US cents for USD).
 */
import { z } from 'zod';

/** An instant with its zone written out (`Z` or an offset): never a time that depends on where the code runs. */
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a date');
const currency = z.string().regex(/^[A-Z]{3}$/);
const amount = z.number().int().positive().max(100_000_000);

const planSchema = z
  .object({
    /** What the payment page and the emails call the plan. */
    label: z.string().min(1).max(80),
    prices: z.record(currency, amount),
  })
  .strict();

const offerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    plan: z.string().min(1),
    currency,
    amount,
    startsAt: instant,
    endsAt: instant,
    /** The `ref` a visitor must arrive with. Without it the offer is for everyone while it runs. */
    code: z
      .string()
      .regex(/^[a-z0-9_-]{1,40}$/)
      .optional(),
  })
  .strict();

const catalogSchema = z
  .object({
    plans: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), planSchema),
    offers: z.array(offerSchema).max(40).default([]),
    /**
     * The currency a visitor is quoted when the page asks for their own: by the two-letter country a request comes
     * from. A country not listed, or a currency the plan has no price in, gets the plan's default.
     */
    currencyByCountry: z.record(z.string().regex(/^[A-Z]{2}$/), currency).default({}),
  })
  .strict();

export interface Offer {
  id: string;
  plan: string;
  currency: string;
  amount: number;
  startsAt: number;
  endsAt: number;
  code?: string;
}

export interface Plan {
  label: string;
  prices: Readonly<Record<string, number>>;
}

export interface Catalog {
  plans: Readonly<Record<string, Plan>>;
  offers: readonly Offer[];
  currencyByCountry: Readonly<Record<string, string>>;
}

/** The catalogue, or null when it is malformed or an offer contradicts its plan. A string is read as JSON. */
export function readCatalog(raw: unknown): Catalog | null {
  const value = typeof raw === 'string' ? parsedJson(raw) : raw;
  const parsed = catalogSchema.safeParse(value);
  if (!parsed.success) return null;
  const offers: Offer[] = [];
  for (const offer of parsed.data.offers) {
    // `hasOwn`: a plan named `constructor` or `toString` is found on every object and is no plan.
    const plan = Object.hasOwn(parsed.data.plans, offer.plan) ? parsed.data.plans[offer.plan] : undefined;
    const list = plan && Object.hasOwn(plan.prices, offer.currency) ? plan.prices[offer.currency] : undefined;
    const startsAt = Date.parse(offer.startsAt);
    const endsAt = Date.parse(offer.endsAt);
    // An offer is a lower price for a plan that has a price in that currency, over a real span of time.
    if (list === undefined || offer.amount >= list || startsAt >= endsAt) return null;
    offers.push({ ...offer, startsAt, endsAt });
  }
  return { plans: parsed.data.plans, offers, currencyByCountry: parsed.data.currencyByCountry };
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the schema refuses undefined.
    return undefined;
  }
}
