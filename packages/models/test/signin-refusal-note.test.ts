// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-SIGNWHY: a token endpoint's refusal keeps the provider's own sentence about it, so "invalid_grant" says which
// grant and why. The sentence is scrubbed first: no value the request sent, nothing token-like, one short line.
import { describe, expect, it } from 'vitest';
import { authFailure } from '../src/credentials/failures';
import { requestToken, SignInFlowError } from '../src/signin/oauth';

const URL = 'https://auth.example.com/oauth/token';
const CODE = 'ac_3fJ9xQ2LmN7pR4tV8wY1zB5c';
const VERIFIER = 'verifier-0123456789abcdefghijklmnopqrstuvwxyz';
const FORM = { grant_type: 'authorization_code', client_id: 'client-1', code: CODE, code_verifier: VERIFIER };

const answering = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

async function refusal(status: number, body: unknown): Promise<SignInFlowError> {
  try {
    await requestToken(answering(status, body), URL, FORM);
  } catch (cause) {
    if (cause instanceof SignInFlowError) return cause;
    throw cause;
  }
  throw new Error('the request was not refused');
}

describe('a refused token request', () => {
  it('keeps the provider’s sentence beside the code', async () => {
    const error = await refusal(400, {
      error: 'invalid_grant',
      error_description: 'The authorization code has expired.',
    });
    expect(error.reason).toBe('rejected');
    expect(error.message).toBe(
      'Token endpoint answered 400 (invalid_grant): The authorization code has expired.',
    );
  });

  it('withholds what the request sent and anything token-like', async () => {
    const error = await refusal(400, {
      error: 'invalid_grant',
      error_description: `Code ${CODE} was issued to another verifier (${VERIFIER}),\n  session rt_9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a.`,
    });
    expect(error.message).not.toContain(CODE);
    expect(error.message).not.toContain(VERIFIER);
    expect(error.message).not.toContain('rt_9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a');
    expect(error.message).not.toContain('\n');
    expect(error.message).toMatch(
      /^Token endpoint answered 400 \(invalid_grant\): Code .+ was issued to another/,
    );
  });

  it('keeps one short line of a long sentence', async () => {
    const error = await refusal(400, { error: 'invalid_request', error_description: 'word '.repeat(300) });
    expect(error.message.length).toBeLessThan(260);
  });

  it('says only the code when the provider gives no sentence, and only the status when it gives no JSON', async () => {
    expect((await refusal(400, { error: 'invalid_grant' })).message).toBe(
      'Token endpoint answered 400 (invalid_grant).',
    );
    expect((await refusal(403, '<html>Forbidden</html>')).message).toBe('Token endpoint answered 403.');
    expect((await refusal(503, { error: 'server_error' })).reason).toBe('network');
  });
});

// FIX-PLANHINT: OpenAI approves a sign-in in the browser and then refuses the code when the ChatGPT account has no
// active plan (the owner, 2026-11-15). That refusal gets its own error, whose sentence says to check the plan.
describe('a sign-in the provider approved and then refused', () => {
  const refused = (oauthError: string) =>
    new SignInFlowError('rejected', `Token endpoint answered 400 (${oauthError}).`, {
      status: 400,
      oauthError,
    });

  it('is its own error when the code was refused, and carries the reason for main’s log', async () => {
    const cause = await refusal(400, { error: 'invalid_grant' });
    expect(cause.extra).toEqual({ status: 400, oauthError: 'invalid_grant' });
    const error = authFailure('openai', cause, 'sign_in', []);
    expect(error).toMatchObject({ code: 'models.sign_in_refused', params: { provider: 'openai' } });
    expect(error.detail).toBe('Token endpoint answered 400 (invalid_grant).');
    // pi-ai wraps what a sign-in hook throws; the refusal is still found.
    expect(authFailure('openai', new Error('login failed', { cause }), 'sign_in', []).code).toBe(
      'models.sign_in_refused',
    );
  });

  it('stays a plain failed sign-in for any other refusal, and a saved login that is refused asks to sign in again', () => {
    expect(authFailure('openai', refused('invalid_client'), 'sign_in', []).code).toBe(
      'models.sign_in_failed',
    );
    expect(
      authFailure('openai', new SignInFlowError('rejected', 'The grant lacks a scope.'), 'sign_in', []).code,
    ).toBe('models.sign_in_failed');
    expect(authFailure('openai', refused('invalid_grant'), 'credential', []).code).toBe(
      'models.sign_in_required',
    );
  });
});
