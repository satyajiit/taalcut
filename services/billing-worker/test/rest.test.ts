// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';

import { type NewLink } from '../src/razorpay/port';
import { createRestProvider } from '../src/razorpay/rest';
import { hmacHex, returnMessage, verifyHmacHex } from '../src/razorpay/signature';
import created from './fixtures/payment-link-created.json' with { type: 'json' };
import paid from './fixtures/payment-link-paid.json' with { type: 'json' };

const KEYS = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'test-key-secret-not-a-secret' };

const NEW_LINK: NewLink = {
  amount: 33900,
  currency: 'USD',
  referenceId: '01KA0000000000000000000001',
  description: 'Taalcut Premium: one month',
  customer: { name: 'Asha Rao', email: 'asha@example.com', contact: '+14155550100' },
  returnUrl: 'https://taalcut.app/premium/thanks/',
  expireBy: 1795132800,
  notes: {
    taalcut_order: '01KA0000000000000000000001',
    taalcut_plan: 'premium',
    taalcut_offer: 'product-hunt',
  },
};

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function provider(answer: (call: Call) => Response | Promise<Response>): {
  calls: Call[];
  client: ReturnType<typeof createRestProvider>;
} {
  const calls: Call[] = [];
  const fetchFake: typeof fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return answer(call);
  };
  return { calls, client: createRestProvider({ keys: KEYS, fetch: fetchFake }) };
}

describe('the REST client', () => {
  it('asks for a link exactly as the provider documents it, and reads the answer', async () => {
    const { calls, client } = provider(() => Response.json(created));
    const result = await client.createLink(NEW_LINK);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('authorization')).toBe(`Basic ${btoa(`${KEYS.keyId}:${KEYS.keySecret}`)}`);
    expect(calls[0]?.body).toEqual({
      amount: 33900,
      currency: 'USD',
      accept_partial: false,
      reference_id: '01KA0000000000000000000001',
      description: 'Taalcut Premium: one month',
      customer: { name: 'Asha Rao', email: 'asha@example.com', contact: '+14155550100' },
      // The provider is told to message nobody: a form must not be a way to email a stranger.
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: 'https://taalcut.app/premium/thanks/',
      callback_method: 'get',
      expire_by: 1795132800,
      notes: NEW_LINK.notes,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'plink_RecordedFix01',
        referenceId: '01KA0000000000000000000001',
        status: 'created',
        amount: 33900,
        amountPaid: 0,
        currency: 'USD',
        url: 'https://rzp.io/i/RecordedFix01',
        payments: [],
      },
    });
  });

  it('reads a paid link with its payment', async () => {
    const { calls, client } = provider(() => Response.json(paid));
    const result = await client.getLink('plink_RecordedFix01');
    expect(calls[0]?.url).toBe('https://api.razorpay.com/v1/payment_links/plink_RecordedFix01');
    expect(calls[0]?.method).toBe('GET');
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'paid',
        amountPaid: 33900,
        payments: [{ id: 'pay_RecordedFix01', status: 'captured', createdAt: 1794528000 }],
      },
    });
  });

  it('tells a refusal from an outage from a missing link, and never passes the provider’s words on', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusal = {
      error: { code: 'BAD_REQUEST_ERROR', description: 'The amount must be at least INR 1.00' },
    };
    const refused = provider(() => Response.json(refusal, { status: 400 }));
    expect(await refused.client.createLink(NEW_LINK)).toEqual({ ok: false, reason: 'refused' });
    expect(logged).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'billing.provider_refused',
        method: 'POST',
        path: '/payment_links',
        status: 400,
        code: 'BAD_REQUEST_ERROR',
        description: 'The amount must be at least INR 1.00',
      }),
    );
    expect(
      await provider(() => Response.json(refusal, { status: 401 })).client.getLink('plink_A1b2C3d4'),
    ).toEqual({
      ok: false,
      reason: 'refused',
    });
    // A sentence that quotes what the buyer typed is logged without it.
    const quoting = {
      error: {
        code: 'BAD_REQUEST_ERROR',
        description: 'asha@example.com is not a valid email for Asha Rao',
        field: 'customer.email',
        reason: 'input_validation_failed',
      },
    };
    await provider(() => Response.json(quoting, { status: 400 })).client.createLink(NEW_LINK);
    expect(logged).toHaveBeenLastCalledWith(
      JSON.stringify({
        event: 'billing.provider_refused',
        method: 'POST',
        path: '/payment_links',
        status: 400,
        code: 'BAD_REQUEST_ERROR',
        field: 'customer.email',
        reason: 'input_validation_failed',
        description: '[withheld] is not a valid email for [withheld]',
      }),
    );
    // A phone number it will not take is told apart, so the buyer can be asked to check it.
    const contact = {
      error: {
        code: 'BAD_REQUEST_ERROR',
        description: 'Recurring digits in customer contact are disallowed',
      },
    };
    expect(await provider(() => Response.json(contact, { status: 400 })).client.createLink(NEW_LINK)).toEqual(
      {
        ok: false,
        reason: 'contact',
      },
    );
    for (const status of [429, 500, 503])
      expect(await provider(() => new Response('busy', { status })).client.getLink('plink_A1b2C3d4')).toEqual(
        {
          ok: false,
          reason: 'unreachable',
        },
      );
    expect(
      await provider(() => new Response('{}', { status: 404 })).client.getLink('plink_A1b2C3d4'),
    ).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(
      await provider(() => {
        throw new TypeError('network');
      }).client.getLink('plink_A1b2C3d4'),
    ).toEqual({ ok: false, reason: 'unreachable' });
    // No log line names a link: the path is logged without its id.
    for (const [line] of logged.mock.calls) expect(String(line)).not.toContain('plink_A1b2C3d4');
    logged.mockRestore();
  });

  it('does not use an answer it cannot read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const body of [{}, { ...created, status: 'settled' }, { ...created, amount: '33900' }, 'ok'])
      expect(await provider(() => Response.json(body)).client.getLink('plink_A1b2C3d4')).toEqual({
        ok: false,
        reason: 'unreachable',
      });
    logged.mockRestore();
  });
});

describe('signatures', () => {
  it('sign a return as "link id|reference|status|payment id" under the key secret', async () => {
    const values = { linkId: 'plink_A', orderId: 'ref_B', status: 'paid', paymentId: 'pay_C' };
    expect(returnMessage(values)).toBe('plink_A|ref_B|paid|pay_C');
    // printf 'plink_A|ref_B|paid|pay_C' | openssl dgst -sha256 -hmac secret
    const signature = 'd417f0485c64281608f28439af74fe608c448430c58249812222730bf84a59ad';
    expect(await hmacHex('secret', returnMessage(values))).toBe(signature);
    expect(await verifyHmacHex('secret', returnMessage(values), signature)).toBe(true);
    expect(await verifyHmacHex('secret', returnMessage(values), signature.toUpperCase())).toBe(true);
    expect(await verifyHmacHex('Secret', returnMessage(values), signature)).toBe(false);
    expect(await verifyHmacHex('secret', 'plink_A|ref_B|created|pay_C', signature)).toBe(false);
  });

  it('agree with a known HMAC-SHA256 value', async () => {
    // RFC 4231 test case 2.
    expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('refuse anything that is not 64 hex characters', async () => {
    for (const bad of ['', 'abc', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])
      expect(await verifyHmacHex('secret', 'message', bad)).toBe(false);
  });
});
