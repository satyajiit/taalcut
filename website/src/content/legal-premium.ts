// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { GistRow, LegalSection } from './legal-types';
import { BOTH_PRICES, PREMIUM, PREMIUM_MATERIAL, PREMIUM_NEEDS, PREMIUM_SENDER } from './premium';
import { SITE } from './site';

/**
 * Taalcut Premium's part of the terms and of the privacy notice (the owner, 2026-11-14), for counsel's review with the
 * rest (content/legal.ts splices them in). The order form's checkbox links to `/terms/#premium` and
 * `/terms/#premium-refunds`, and its privacy line to `/privacy/#premium`: those ids are addresses, so they stay.
 * Every fact is the plan's (content/premium.ts) or the billing service's own behaviour: what an order holds, that an
 * order never paid is deleted within 30 days, and that the payment page is our payment provider's. Visitor text names
 * no product (claims.ts › STACK_NAMES, PREMIUM_RULES).
 */

const mail = `[${SITE.email}](mailto:${SITE.email})`;
const company = `[${SITE.company.legal}](${SITE.company.url})`;
const days = PREMIUM.activationDays;

/** The terms: what Premium is and how it is paid for, then refunds and cancelling as a section a link can point to. */
export const TERMS_PREMIUM: readonly LegalSection[] = [
  {
    id: 'premium',
    heading: PREMIUM.name,
    blocks: [
      {
        kind: 'p',
        text: `${PREMIUM.name} is a paid plan around the free app, sold by ${company}. The app stays free under its licence, with or without Premium. Ordering on the [Premium page](${PREMIUM.path}) means you agree to this section and the next.`,
      },
      {
        kind: 'facts',
        facts: [
          [
            'What you get',
            `What the [Premium page](${PREMIUM.path}#included) lists on the day you pay: setup on your Mac in one live session by screen share, the top cloud models paid by us, WhatsApp support, advice for your channels, and the rest of that list.`,
          ],
          [
            'Price',
            `${BOTH_PRICES}. The order page shows the price in Indian rupees to visitors in India and in US dollars elsewhere, and lets you choose the other. You pay the price shown; nothing is added on the payment page. If the order page shows a launch price, it is the price of your first month, and later months are the list price in the currency you paid in.`,
          ],
          [
            'Paying',
            'Month to month. Each month we send you one payment link, and paying it buys that month. We keep no card, and nothing is charged automatically. Each payment has a receipt from our payment provider, and we send an invoice if you ask for one.',
          ],
          [
            'Activation',
            `Within one business day of your payment we write to you to book your setup session. Your plan is active within ${days} days of your payment.`,
          ],
          ['Your month', 'Your paid month starts on the day your plan is active, not the day you pay.'],
          ['What it needs', PREMIUM_NEEDS],
          [
            'Fair use',
            'The models we pay for are for one creator’s own publishing. They are not for resale, and not for automated bulk runs.',
          ],
          ['Support hours', 'WhatsApp support runs from Monday 00:00 to Friday 24:00, India time (IST).'],
          [
            'Advice',
            'Advice is advice. We promise no reach, views or income from it, and a make can still fail on any model.',
          ],
          ['Agency work', 'Work beyond the plan is scoped with you and quoted before it starts.'],
          ['Your material', `${PREMIUM_MATERIAL} The [privacy notice](/privacy/#premium) says what we keep.`],
        ],
      },
    ],
  },
  {
    id: 'premium-refunds',
    heading: 'Premium refunds and cancelling',
    blocks: [
      {
        kind: 'facts',
        facts: [
          [
            `Not active by day ${days}`,
            `If your plan is not active ${days} days after your payment, we refund that payment in full.`,
          ],
          ['After activation', 'Once your plan is active, a paid month is not refunded.'],
          [
            'Cancelling',
            'Nothing renews by itself, so there is nothing to cancel. You stop by not paying the next month’s payment link, and your plan ends when the month you paid for does.',
          ],
          ['Asking', `Write to ${mail} from the address you ordered with.`],
        ],
      },
    ],
  },
];

/** The privacy notice: what an order holds, who handles the payment, and where a Premium make's material goes. */
export const PRIVACY_PREMIUM: LegalSection = {
  id: 'premium',
  heading: `A ${PREMIUM.name} order`,
  blocks: [
    {
      kind: 'p',
      text: `Ordering [${PREMIUM.name}](${PREMIUM.path}) sends the order form to our billing service. This is what an order holds and what happens to it:`,
    },
    {
      kind: 'facts',
      facts: [
        [
          'What we keep',
          'Your name, your email address and your WhatsApp number; your channel, if you gave it; the country the order came from, which our billing service reads from the request; the plan, its price and the launch price it came with, if any; the time you ordered; and the payment’s reference numbers and status.',
        ],
        [
          'Our payment provider',
          'To make your payment page, our billing service gives our payment provider your name, your email address and your phone number. You type your card details on its page, and we never see them. It tells us whether the payment went through, with its reference numbers.',
        ],
        [
          'The currency you see',
          'Our billing service picks the currency the Premium page shows you from the country your request comes from. You can choose the other on that page.',
        ],
        [
          'Limiting abuse',
          'To limit abuse, our billing service counts orders against a scrambled form of the network address a request came from. The address itself is not stored, and the count is deleted within two days.',
        ],
        [
          'Why',
          'To take your order, to reach you and set your plan up, and to keep the records the law asks of a seller.',
        ],
        ['Our basis', 'The contract you enter when you order and, for the records, the law.'],
        [
          'How long',
          'An order that is never paid is deleted within 30 days. A paid order is kept for as long as tax and accounting law requires.',
        ],
        [
          'After you pay',
          'The page you come back to gets the payment’s reference numbers in its address. It hands them to our billing service and takes them out of the address at once, so the visit counts don’t record them. Once the payment is confirmed, the page keeps the outcome in your browser until you close the tab, so a reload still shows it.',
        ],
        [
          'Emails after you pay',
          `One email from us, sent from ${PREMIUM_SENDER} under the name Taalcut, saying your payment is in and what happens next. That address only sends: replies go to ${mail}. Our payment provider sends its own receipt.`,
        ],
        [
          'Your makes on Premium',
          `${PREMIUM_MATERIAL} Those providers process that material to run the models.`,
        ],
        [
          'WhatsApp',
          'We use your WhatsApp number to book your setup session and for support. WhatsApp’s own terms and privacy policy cover the messages there.',
        ],
      ],
    },
  ],
};

/** The gist's line for Premium (PRIVACY_GIST). */
export const PRIVACY_PREMIUM_GIST: GistRow = {
  section: 'premium',
  text: 'A Premium order keeps your name, your contact details and the payment’s reference numbers. Our payment provider handles your card, and we never see it.',
};

/** Who handles a Premium order for us, and where it is kept: one paragraph each for the notice's own two sections. */
export const PRIVACY_PREMIUM_PROCESSORS =
  'For Taalcut Premium, a second cloud provider runs our billing service and stores the orders, our payment provider takes the payment on its own page, and model providers run the cloud models a Premium make uses. Each one’s own privacy policy and terms apply to what it handles.';
export const PRIVACY_PREMIUM_WHERE =
  'Premium orders are on the servers of the cloud provider that runs our billing service. Those servers, our payment provider’s and the model providers’ may be outside India.';
