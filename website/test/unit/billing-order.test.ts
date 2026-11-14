// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { dayWords, momentWords, money, waitWords } from '#lib/billing/money';
import {
  CHANNEL_MAX,
  NAME_MAX,
  ORDER_EMAIL,
  type OrderAnswers,
  RETURN_KEYS,
  checkoutRequest,
  cleanName,
  fieldOf,
  hasUnsafe,
  normalizeChannel,
  normalizeWhatsapp,
  orderEmailProblem,
  orderProblems,
  refusedFields,
  returnValues,
} from '#lib/billing/order';

const GOOD: OrderAnswers = {
  name: 'Asha Rao',
  email: 'asha@example.com',
  whatsapp: '+14155550100',
  channel: '',
  agreed: true,
};

describe('the order form’s answers', () => {
  it('pass when the three required fields and the agreement are there', () => {
    expect(orderProblems(GOOD)).toEqual([]);
    // The number is required: the payment provider makes no payment page without one.
    expect(orderProblems({ ...GOOD, whatsapp: ' ' })).toEqual([{ field: 'whatsapp', problem: 'empty' }]);
    expect(orderProblems({ ...GOOD, whatsapp: '+91 98765 43210', channel: 'instagram.com/asha' })).toEqual(
      [],
    );
  });

  it('name each problem by its field, in the form’s order', () => {
    expect(
      orderProblems({ name: ' ', email: 'asha@', whatsapp: '98765', channel: 'my channel', agreed: false }),
    ).toEqual([
      { field: 'name', problem: 'empty' },
      { field: 'email', problem: 'malformed' },
      { field: 'whatsapp', problem: 'malformed' },
      { field: 'channel', problem: 'malformed' },
      { field: 'agreed', problem: 'missing' },
    ]);
    expect(orderProblems({ ...GOOD, name: 'A' })).toEqual([{ field: 'name', problem: 'too-short' }]);
    expect(orderProblems({ ...GOOD, name: 'a'.repeat(NAME_MAX + 1) })).toEqual([
      { field: 'name', problem: 'too-long' },
    ]);
    expect(orderProblems({ ...GOOD, name: 'a'.repeat(NAME_MAX) })).toEqual([]);
    expect(orderProblems({ ...GOOD, email: '' })).toEqual([{ field: 'email', problem: 'empty' }]);
    expect(orderProblems({ ...GOOD, channel: `https://example.com/${'a'.repeat(CHANNEL_MAX)}` })).toEqual([
      { field: 'channel', problem: 'too-long' },
    ]);
  });

  it('reads a WhatsApp number however it is typed, and refuses what isn’t one', () => {
    expect(normalizeWhatsapp('')).toBe('');
    expect(normalizeWhatsapp('   ')).toBe('');
    for (const typed of [
      '+14155550100',
      '+1 415 555 0100',
      '+1 (415) 555-0100',
      '+1.415.555.0100',
      '0014155550100',
    ]) {
      expect(normalizeWhatsapp(typed), typed).toBe('+14155550100');
    }
    for (const typed of [
      '4155550100',
      '+0415555010',
      '+1415',
      '+1415555010012345678',
      'call me',
      '+1415555O100',
    ]) {
      expect(normalizeWhatsapp(typed), typed).toBeNull();
    }
  });

  it('checks an address by the billing service’s own rule, so a refusal shows beside the field first', () => {
    // The service's pattern, character for character.
    expect(ORDER_EMAIL.source).toBe(String.raw`^[^\s@<>"',;:\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$`);
    expect(ORDER_EMAIL.flags).toBe('i');
    for (const ok of [
      'asha@example.com',
      ' Asha.Rao+reels@Studio.Example.IN ',
      'ñandú@correo.es',
      'a/b@c.co',
      'a@b.c',
      'o’brien@example.com',
    ]) {
      expect(orderEmailProblem(ok), ok).toBeNull();
    }
    expect(orderEmailProblem('  ')).toBe('empty');
    expect(orderEmailProblem(`${'a'.repeat(250)}@x.co`)).toBe('too-long');
    expect(orderEmailProblem(`${'a'.repeat(249)}@x.co`)).toBeNull();
    // The shape of an address is missing: the form's plain words name what.
    for (const bad of ['asha', 'asha@', 'asha@example', '@example.com', 'asha rao@example.com', 'a@b@c.co']) {
      expect(orderEmailProblem(bad), bad).toBe('malformed');
    }
    // The shape is there, with a character the service doesn't take: punctuation before the @, anything but plain
    // letters, digits and hyphens after it, or a character that hides or reorders text.
    for (const bad of [
      'asha,rao@example.com',
      'asha;rao@example.com',
      '"asha"@example.com',
      '<asha>@example.com',
      'asha:rao@example.com',
      'asha@bücher.de',
      'asha@exa_mple.com',
      'asha\u202e@example.com',
      'asha\u0007@example.com',
      'asha\u200f@example.com',
    ]) {
      expect(orderEmailProblem(bad), JSON.stringify(bad)).toBe('characters');
    }
    expect(orderProblems({ ...GOOD, email: 'asha@bücher.de' })).toEqual([
      { field: 'email', problem: 'characters' },
    ]);
  });

  it('refuses a name with a character that hides or reorders text, as the billing service does', () => {
    expect(hasUnsafe('Asha Rao')).toBe(false);
    expect(hasUnsafe('आशा राव')).toBe(false);
    for (const unsafe of ['Asha\u202eRao', 'Asha\u0000', 'Asha\u2066', 'Asha\u200e', 'Asha\u007f']) {
      expect(hasUnsafe(unsafe), JSON.stringify(unsafe)).toBe(true);
      expect(orderProblems({ ...GOOD, name: unsafe })).toEqual([{ field: 'name', problem: 'refused' }]);
    }
    // A tab or a line break in a name is only space: it is collapsed, not refused.
    expect(orderProblems({ ...GOOD, name: 'Asha\tRao' })).toEqual([]);
  });

  it('reads a channel as a link or a handle', () => {
    expect(normalizeChannel('')).toBe('');
    expect(normalizeChannel('instagram.com/asha')).toBe('https://instagram.com/asha');
    expect(normalizeChannel(' https://www.youtube.com/@asha ')).toBe('https://www.youtube.com/@asha');
    expect(normalizeChannel('http://example.in/reels')).toBe('http://example.in/reels');
    expect(normalizeChannel('@asha.reels')).toBe('@asha.reels');
    for (const typed of [
      'asha',
      'my channel',
      'ftp://example.com/a',
      'javascript:alert(1)',
      'https://localhost/a',
      '@',
      '@as ha',
      "example.com/a'b",
      'https://user@example.com/',
    ]) {
      expect(normalizeChannel(typed), typed).toBeNull();
    }
    expect(normalizeChannel(`example.com/${'a'.repeat(CHANNEL_MAX)}`)).toBe('too-long');
  });

  it('builds the order the billing service takes, with only what was given', () => {
    expect(
      checkoutRequest(
        { ...GOOD, name: '  Asha   Rao ', email: ' Asha@Example.COM ' },
        { plan: 'premium', ref: null, expect: 40000 },
      ),
    ).toEqual({
      plan: 'premium',
      name: 'Asha Rao',
      email: 'asha@example.com',
      whatsapp: '+14155550100',
      agreed: true,
      expect: 40000,
    });
    expect(
      checkoutRequest(
        { ...GOOD, whatsapp: '+1 (415) 555-0100', channel: 'instagram.com/asha' },
        { plan: 'premium', ref: 'producthunt', expect: 33900 },
      ),
    ).toEqual({
      plan: 'premium',
      ref: 'producthunt',
      name: 'Asha Rao',
      email: 'asha@example.com',
      whatsapp: '+14155550100',
      channel: 'https://instagram.com/asha',
      agreed: true,
      expect: 33900,
    });
    expect(cleanName(' a  b ')).toBe('a b');
  });

  it('builds nothing while a problem stands: an order is never sent without the agreement or the number', () => {
    expect(
      checkoutRequest({ ...GOOD, whatsapp: '' }, { plan: 'premium', ref: null, expect: 40000 }),
    ).toBeNull();
    expect(
      checkoutRequest({ ...GOOD, agreed: false }, { plan: 'premium', ref: null, expect: 40000 }),
    ).toBeNull();
    expect(
      checkoutRequest({ ...GOOD, email: 'asha' }, { plan: 'premium', ref: null, expect: 40000 }),
    ).toBeNull();
  });

  it('puts the service’s refusals on the fields they name', () => {
    expect(fieldOf('email')).toBe('email');
    expect(fieldOf('/whatsapp')).toBe('whatsapp');
    expect(fieldOf('body.channel')).toBe('channel');
    expect(fieldOf('agreed')).toBe('agreed');
    for (const path of ['', 'expect', 'plan', 'ref', 'signature', 'nameless'])
      expect(fieldOf(path), path).toBeNull();
    expect(
      refusedFields([
        { path: 'channel', rule: 'format' },
        { path: 'name', rule: 'tooShort' },
        { path: 'name', rule: 'format' },
        { path: 'expect', rule: 'format' },
      ]),
    ).toEqual([
      { field: 'name', problem: 'refused' },
      { field: 'channel', problem: 'refused' },
    ]);
    expect(refusedFields([{ path: 'plan', rule: 'unknown' }])).toEqual([]);
    // An order without the number gets the form's own words; a number of the wrong shape, the service's refusal.
    expect(refusedFields([{ path: 'whatsapp', rule: 'required' }])).toEqual([
      { field: 'whatsapp', problem: 'empty' },
    ]);
    expect(refusedFields([{ path: 'whatsapp', rule: 'format' }])).toEqual([
      { field: 'whatsapp', problem: 'refused' },
    ]);
  });
});

describe('the values a payment comes back with', () => {
  const query = new URLSearchParams({
    razorpay_payment_id: 'pay_Abc123',
    razorpay_payment_link_id: 'plink_Abc123',
    razorpay_payment_link_reference_id: '01KA7Q3ZV5R8N2M4X6C9D1E3F5',
    razorpay_payment_link_status: 'paid',
    razorpay_signature: 'a'.repeat(64),
  });

  it('are read from the address under the names the billing service takes', () => {
    expect(returnValues(`?${query.toString()}`)).toEqual({
      orderId: '01KA7Q3ZV5R8N2M4X6C9D1E3F5',
      linkId: 'plink_Abc123',
      paymentId: 'pay_Abc123',
      status: 'paid',
      signature: 'a'.repeat(64),
    });
    expect(Object.keys(RETURN_KEYS).sort()).toEqual([
      'linkId',
      'orderId',
      'paymentId',
      'signature',
      'status',
    ]);
    expect(returnValues(`?utm_source=x&${query.toString()}`)?.status).toBe('paid');
  });

  it('are nothing unless all five are there', () => {
    expect(returnValues('')).toBeNull();
    expect(returnValues('?ref=producthunt')).toBeNull();
    for (const key of query.keys()) {
      const less = new URLSearchParams(query);
      less.delete(key);
      expect(returnValues(`?${less.toString()}`), key).toBeNull();
      const blank = new URLSearchParams(query);
      blank.set(key, ' ');
      expect(returnValues(`?${blank.toString()}`), key).toBeNull();
    }
    const long = new URLSearchParams(query);
    long.set('razorpay_signature', 'a'.repeat(300));
    expect(returnValues(`?${long.toString()}`)).toBeNull();
  });
});

describe('money, days and waits in words', () => {
  it('writes an amount of minor units as money, without cents that are zero', () => {
    expect(money(40000, 'USD')).toBe('$400');
    expect(money(33900, 'USD')).toBe('$339');
    expect(money(33950, 'USD')).toBe('$339.50');
    expect(money(120000, 'USD')).toBe('$1,200');
    // A currency without minor units is not divided by a hundred.
    expect(money(5000, 'JPY')).toBe('¥5,000');
    expect(money(3300000, 'INR')).toBe('₹33,000');
  });

  it('writes a day and a moment in the zone it is given', () => {
    expect(dayWords('2026-11-26T09:00:00.000Z', 'UTC')).toBe('26 November 2026');
    expect(dayWords('2026-11-26T20:00:00.000Z', 'Asia/Kolkata')).toBe('27 November 2026');
    const ends = momentWords('2026-11-26T08:01:00.000Z', 'Asia/Kolkata');
    expect(ends).toMatch(/^26 November/);
    expect(ends).toMatch(/13:31/);
    expect(ends).toMatch(/IST|GMT\+5:30/);
    expect(momentWords('2026-11-26T08:01:00.000Z', 'America/Los_Angeles')).toMatch(
      /^26 November.*00:01|^26 November.*0:01/,
    );
  });

  it('writes a wait rounded up, in the unit that fits', () => {
    expect(waitWords(1)).toBe('1 second');
    expect(waitWords(0.2)).toBe('1 second');
    expect(waitWords(45)).toBe('45 seconds');
    expect(waitWords(90)).toBe('2 minutes');
    expect(waitWords(600)).toBe('10 minutes');
    expect(waitWords(7200)).toBe('2 hours');
  });
});
