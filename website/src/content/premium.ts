// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { usd } from './cost';
import { RELEASE } from './release';
import type { Fact } from './schema';
import { SITE } from './site';

/**
 * Taalcut Premium: the paid plan around the free app (the owner, 2026-11-14). Every word and constant of the plan is
 * here; /premium/, /premium/thanks/, the FAQ, the terms, the .md mirror, llms.txt and the JSON-LD read them.
 *
 * The price the page charges is never typed in a browser: the billing service quotes it (lib/billing) and the page
 * shows the quote. LIST below is the list price as the static HTML and the machine-read files say it; the launch
 * prices exist only in the quote. Premium is a plan you buy: the ledger (claims.ts) bans the words that would make it
 * a stage of one, any promise of a result, and any hint that someone already uses it.
 */
export const PREMIUM = {
  name: `${SITE.name} Premium`,
  short: 'Premium',
  path: '/premium/',
  thanksPath: '/premium/thanks/',
  /** The plan's id in the billing service's API. */
  plan: 'premium',
  currency: 'USD',
  /** The list price a month, in US cents. */
  listAmount: 40000,
  /** A plan is active within this many days of its payment. */
  activationDays: 7,
} as const;

/** The list price in words: "$400". */
export const LIST_PRICE = usd(PREMIUM.listAmount / 100);
export const PER_MONTH = 'a month';

/**
 * The address the billing service's one email to a buyer comes from, under the name Taalcut. It only sends: replies to
 * that email go to SITE.email, which stays the one address anybody writes to. Said only where the site lists the
 * messages a buyer gets, and never as a link.
 */
export const PREMIUM_SENDER = 'premium@taalcut.app';

/** The one address, as a link in content text. */
const mail = `[${SITE.email}](mailto:${SITE.email})`;

/** What Premium needs, from the release's own requirements. */
export const PREMIUM_NEEDS = `A Mac with ${RELEASE.chip} on ${RELEASE.system}, the same as the app.`;

/** Where a make's material goes: said beside the order, in the FAQ, the terms and the privacy notice. */
export const PREMIUM_MATERIAL =
  'Premium sends the material a make needs to cloud models, which model providers run for us. The free app’s on-device mode is unchanged.';

/**
 * A launch price, as the page says one when the billing service quotes it. It is the first month's price: `first`
 * stands where "a month" does, and `later` says what the months after it cost. The names are by the service's offer
 * id; an id the site doesn't know reads as a launch price.
 */
export const OFFER = {
  names: { 'product-hunt': 'Product Hunt launch price', 'launch-day': 'Launch day price' } as Readonly<
    Record<string, string>
  >,
  name: 'Launch price',
  first: 'for your first month',
  later: `Later months are ${LIST_PRICE} ${PER_MONTH}.`,
  /** "Product Hunt launch price, until 26 November at 13:31 IST." */
  until: (name: string, when: string) => `${name}, until ${when}.`,
  /** For assistive technology, before the struck-through price. */
  list: 'List price',
} as const;

/** An offer's name on the page, by its id. */
export function offerName(id: string): string {
  return OFFER.names[id] ?? OFFER.name;
}

export const PREMIUM_PAGE = {
  title: ['Taalcut Premium.', 'Set up for you, on the top models.'],
  lead: 'Taalcut stays free. Premium is the service around it: we install it on your Mac with you, pay for the top cloud models, and answer on WhatsApp while you make.',
  stickers: { monthly: 'Month to month', active: 'Active within 7 days', models: 'Top models, paid by us' },
  /** The price card beside the head. */
  card: {
    heading: 'The plan',
    order: 'Order Premium',
    facts: [
      'One payment link a month. No stored card, no automatic charge.',
      'Active within 7 days of payment. Your paid month starts that day.',
      'Not active by day 7? We refund you in full.',
    ],
  },
  included: {
    id: 'included',
    heading: 'What you get',
    lead: 'Someone to set it up with you, the top models to make with, and people to ask.',
    rows: [
      ['Installed and set up for you', 'We install Taalcut on your Mac and set it up with you.'],
      ['One live setup session', 'One live setup session, by screen share (TeamViewer or Google Meet).'],
      [
        'The top models, paid by us',
        'The top cloud models, paid by us: no keys, no model bills of your own.',
      ],
      ['Every make on the top models', 'Every make runs on the top models instead of the on-device ones.'],
      ['WhatsApp support', 'WhatsApp support around the clock, Monday to Friday.'],
      [
        'Advice for your channels',
        'Advice for Instagram, YouTube and other creator platforms: formats, hooks, posting rhythm.',
      ],
      [
        'An agency on call',
        'An AI-native agency on call: bring an idea (a series, a launch video, a channel format), and we help build it.',
      ],
      ['Priority fixes', 'Your bug reports and requests go to the front of the queue.'],
      ['A monthly check-in', 'Thirty minutes on what you published and what to try next.'],
      ['New things first', 'New features reach you first.'],
    ] satisfies readonly Fact[],
  },
  activation: {
    id: 'activation',
    heading: 'From payment to active',
    steps: [
      {
        title: 'Pay for a month',
        body: 'Order below and pay on our payment provider’s page. You get its receipt by email, and one email from us saying your payment is in and what happens next.',
      },
      {
        title: 'We write to you',
        body: 'Within one business day we write to you, by email or WhatsApp, to book your setup session.',
      },
      {
        title: 'One setup session',
        body: 'By screen share, on TeamViewer or Google Meet, we install Taalcut on your Mac and set it up with you.',
      },
      {
        title: 'Active within 7 days',
        body: 'Your plan is active within 7 days of payment, and your paid month starts that day. If it isn’t active by day 7, we refund you in full.',
      },
    ],
  },
  notes: {
    id: 'notes',
    heading: 'Before you order',
    rows: [
      ['What it needs', PREMIUM_NEEDS],
      ['Where your material goes', PREMIUM_MATERIAL],
      [
        'Fair use',
        'The models we pay for are for one creator’s own publishing: not for resale, and not for automated bulk runs.',
      ],
      ['Advice', 'Advice is advice. Nobody can promise reach, views or income, and we don’t.'],
      ['Agency work', 'Work beyond your plan is scoped with you and quoted before it starts.'],
      ['Support hours', 'WhatsApp support runs from Monday 00:00 to Friday 24:00, India time.'],
      [
        'Paying',
        `In US dollars, month to month, by one payment link a month. Each payment has a receipt, and an invoice if you ask. The [Premium terms](/terms/#premium) and the [refund and cancellation terms](/terms/#premium-refunds) say the rest.`,
      ],
    ] satisfies readonly Fact[],
  },
  questions: { id: 'questions', heading: 'Questions about Premium' },
} as const;

/** The two answers the site's FAQ also carries (content/faq.ts), word for word. */
export const FAQ_STILL_FREE = {
  id: 'still-free',
  question: 'Is Taalcut still free?',
  answer: `Yes. The app is free, and its code is on GitHub under the ${SITE.licence.name} licence. Premium is a paid service around the app, and it takes nothing out of the free app.`,
} as const;

export const FAQ_PREMIUM = {
  id: 'premium',
  question: 'What is Premium?',
  answer: `${PREMIUM.name} is a paid plan around the free app, at ${LIST_PRICE} ${PER_MONTH}. We install Taalcut on your Mac and set it up with you in one live session, pay for the top cloud models so every make runs on them, answer on WhatsApp around the clock from Monday to Friday, and advise on Instagram, YouTube and other creator platforms. A plan is active within ${PREMIUM.activationDays} days of payment. It is at ${SITE.origin}${PREMIUM.path}.`,
} as const;

/** /premium/'s own questions, after "Is Taalcut still free?". Plain sentences: the page and its mirror print them. */
export const PREMIUM_QUESTIONS: readonly {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}[] = [
  FAQ_STILL_FREE,
  {
    id: 'paying',
    question: 'How do I pay, and what renews?',
    answer:
      'You pay for one month through a payment link. Nothing renews by itself: we keep no card and charge nothing automatically. Each month we send a new payment link, and paying it continues your plan.',
  },
  {
    id: 'month-starts',
    question: 'When does my month start?',
    answer: `On the day your plan is active, not the day you pay. Activation takes up to ${PREMIUM.activationDays} days from payment.`,
  },
  {
    id: 'refunds',
    question: 'Can I get a refund?',
    answer: `If your plan isn’t active ${PREMIUM.activationDays} days after you paid, we refund you in full. Once it is active, a paid month isn’t refunded, and you stop by not paying the next one.`,
  },
  {
    id: 'material',
    question: 'Does my footage leave my Mac?',
    answer: `${PREMIUM_MATERIAL} There, you choose what leaves your Mac.`,
  },
  {
    id: 'not-a-mac',
    question: 'What if I’m not on a Mac?',
    answer: 'Premium needs a Mac with Apple silicon, like the app. Ubuntu and Windows have no download yet.',
  },
];

/** The order form's words (components/premium/order-form.tsx). Errors name the cause and one fix. */
export const ORDER = {
  id: 'order',
  heading: 'Order Premium',
  lead: 'Tell us who you are and where to reach you. You pay on our payment provider’s page, then come back here.',
  name: 'Your name',
  email: 'Your email',
  whatsapp: 'WhatsApp number',
  channel: 'Your channel',
  optional: 'Optional',
  whatsappHint: 'With your country code, like +14155550100',
  /** Why the number is asked for, under its field. */
  whatsappWhy:
    'Our payment provider needs a phone number to make your payment page, and we use it to book your setup session and for support.',
  channelHint: 'A link or an @handle',
  /** The agreement beside the checkbox, with its two links. */
  agree:
    'I agree to the [Premium terms](/terms/#premium) and the [refund and cancellation terms](/terms/#premium-refunds).',
  privacy: 'What we keep is in the [privacy notice](/privacy/#premium).',
  submit: 'Continue to payment',
  pricing: 'Checking the price…',
  submitting: 'Opening the payment page…',
  tryAgain: 'Try again',
  /** Shown in place of the form when orders are off or the billing service can't be reached. */
  closed: `We can’t take orders on this page right now. Write to ${mail} and we send you a payment link.`,
  india: `A card issued in India usually can’t pay in US dollars. Write to ${mail} and we arrange a way to pay.`,
  noScript: `The order form needs JavaScript. You can also write to ${mail} and we send you a payment link.`,
  problems: {
    nameEmpty: 'Add your name, or what to call you.',
    nameShort: 'Write at least two letters.',
    nameLong: 'Keep your name under 80 characters.',
    /** One line in the field's slot from 360 px up, like the others: the cause, and the fix by example. */
    whatsappEmpty: 'Add your number, like +14155550100.',
    whatsapp: 'Start with + and your country code.',
    channel: 'Add a link like instagram.com/yourname, or an @handle.',
    channelLong: 'Keep the link under 200 characters.',
    agree: 'Tick the box to agree to the terms.',
    /** An address with the shape of one, and a character the billing service doesn't take. */
    emailChars: 'Take out what an address can’t have, like a comma, a quote or an accent after the @.',
    /** A field the billing service refused without saying more. */
    field: 'Our check didn’t accept this. Look at it again.',
  },
  /**
   * One sentence for each refusal (lib/billing/api.ts › BillingFailure). Nothing was charged in any of them. Two have
   * no line here: when orders are off, or the service refuses a page that isn't the website's, the form gives way to
   * `closed`. A wait can be hours (a day's allowance), so the line never promises a short one: it names the wait the
   * service gave, or says later, and gives the address.
   */
  refusals: {
    invalid: 'The order didn’t pass our check. Look at each field.',
    'price-changed': 'The price changed while this page was open. Check the new price, then continue.',
    'rate-limited': `Too many tries from here. Try again later, or write to ${mail}.`,
    busy: 'Our side had a problem. Nothing was charged.',
    'provider-unavailable': 'Our payment provider didn’t answer. Nothing was charged.',
    'not-found': 'This page is out of date. Reload it.',
    offline: 'You’re offline. Nothing was sent.',
    timeout: 'Our billing service didn’t answer in time. Nothing was charged.',
    unreachable: 'We couldn’t reach our billing service. Nothing was charged.',
    unexpected: 'Something unexpected came back. Nothing was charged.',
  },
  /** With the wait the billing service names: "Too many tries from here. Try again in 5 hours, or write to …" */
  rateLimitedFor: (wait: string) => `Too many tries from here. Try again in ${wait}, or write to ${mail}.`,
} as const;

/** /premium/thanks/: one state each for what the billing service says about the payment. */
export const THANKS = {
  lead: 'This page checks your payment with our billing service, right after you pay.',
  checking: { heading: 'Checking your payment…', body: 'This takes a moment.' },
  paid: {
    heading: 'Payment received.',
    line: (amount: string) => `We have your payment of ${amount} for ${PREMIUM.name}.`,
    nextHeading: 'What happens next',
    next: [
      'Within one business day we write to you, by email or WhatsApp, to book your setup session.',
      'In one session by screen share, we install Taalcut on your Mac and set it up with you.',
    ],
    activeBy: (date: string) =>
      `Your plan is active by ${date}, and your paid month starts on the day it is. If it isn’t active by then, we refund you in full.`,
    reference: 'Your order reference',
    /** The messages a buyer gets, exactly: the provider's receipt, and one email from the billing service. */
    emails: `You get two emails: our payment provider’s receipt, and one from Taalcut (${PREMIUM_SENDER}) saying your payment is in and what happens next.`,
  },
  pending: {
    heading: 'We don’t see your payment yet.',
    body: 'It can take a minute to reach us. The receipt our payment provider emails you is proof of payment.',
  },
  expired: { heading: 'This payment link expired.', body: 'Nothing was charged. You can order again.' },
  cancelled: { heading: 'This payment was cancelled.', body: 'Nothing was charged. You can order again.' },
  missing: {
    heading: 'Nothing to check here.',
    body: 'This page checks a payment right after you pay. If you paid, the receipt our payment provider emailed you is proof of payment.',
  },
  refused: {
    heading: 'We couldn’t match these payment details.',
    body: 'If you paid, the receipt our payment provider emailed you is proof of payment. Send it to us and we sort it out.',
  },
  unreachable: {
    heading: 'We couldn’t reach our billing service.',
    body: 'Your payment isn’t affected. Check again later, or write to us.',
  },
  noScript:
    'This page needs JavaScript to check your payment. The receipt our payment provider emails you is proof of payment.',
  checkAgain: 'Check again',
  back: 'Back to Premium',
  /** Every state ends with the address. */
  write: `Questions about your order: ${mail}.`,
} as const;

/** The .md mirror's own two lines (lib/llms/premium-md.ts): the price without a browser, and how to order. */
export const PREMIUM_MIRROR = {
  price: `${LIST_PRICE} ${PER_MONTH}, in US dollars. When a launch price applies, the page shows it with the moment it ends, and it is the price of the first month.`,
  order: `Order on the [Premium page](${PREMIUM.path}#order), or write to ${mail} and we send you a payment link.`,
} as const;

/** The ways to Premium from other pages. */
export const PREMIUM_POINTERS = {
  /** The home page's cost section, after the comparison. */
  home: { line: 'Would you rather we set it up and pay for the models?', link: PREMIUM.name },
  /** /download/, under the buttons. */
  download: `Want it installed and set up for you, on the top models? [${PREMIUM.name}](${PREMIUM.path}) is ${LIST_PRICE} ${PER_MONTH}.`,
  /** The mirrors and llms.txt: the plan in one sentence. */
  machine: `${PREMIUM.name} is a paid plan around the free app, at ${LIST_PRICE} ${PER_MONTH}: ${SITE.origin}${PREMIUM.path}.`,
} as const;
