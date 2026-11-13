// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Continue with ChatGPT" (PRD R25): OpenAI's Sign in with ChatGPT token
 * sharing, a public-client OAuth flow with PKCE whose access token goes
 * straight to api.openai.com's Responses API and bills the user's ChatGPT plan.
 *
 * The endpoints, client registration and scopes are pi-ai's (1.4.0, unchanged
 * since 1.1.0: dist/auth/oauth/openai-chatgpt.js), not ours. We re-implement the flow on top
 * of them because pi-ai's version hard-codes its endpoints and fetch, so it
 * can't be tested against a mock server, and it races a "paste the URL"
 * prompt we don't show. It plugs into pi-ai as the openai provider's OAuth
 * method, so pi-ai still owns the locked refresh and request auth.
 */
import type {
  LoginOptions,
  OAuthAuth,
  OAuthCredential,
  ProviderAuthInteraction,
} from '@earendil-works/pi-ai';
import type { FetchFn } from '../client/http-meter';
import {
  startLoopbackCallback,
  type CallbackOutcome,
  type LoopbackCallback,
  type Translate,
} from './loopback';
import {
  createPkce,
  emailFromIdToken,
  randomToken,
  requestToken,
  SignInFlowError,
  type TokenResponse,
} from './oauth';

/** pi-ai's constants for Sign in with ChatGPT. */
export const CHATGPT_SIGN_IN = {
  authorizeUrl: 'https://auth.openai.com/api/accounts/authorize',
  tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token',
  resource: 'https://api.openai.com/v1',
  /** Every sign-in registers a new client under this id; the callback returns the issued id. */
  registrationClientId: 'dynamic_agent_client',
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  requiredScope: 'chatgpt.tokens.use.direct',
  callbackPort: 1455,
  callbackPath: '/auth/callback',
  usageUrl: 'https://chatgpt.com/settings/usage',
} as const;

export interface ChatGPTSignInOptions {
  /** Override for tests (a mock OAuth server). Default: OpenAI's. */
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  /**
   * Loopback port for the redirect. Default 1455, the redirect URI pi-ai and
   * the Codex CLI use, which OpenAI is known to accept. 0 picks a free port
   * (RFC 8252); whether OpenAI accepts that is untested.
   */
  readonly callbackPort?: number;
  /** How long to wait for the browser. Default 5 minutes. */
  readonly timeoutMs?: number;
  /** HTTP for the token endpoint. Default: globalThis.fetch, read per call. */
  readonly fetch?: FetchFn;
  /** Text for the callback page. Default: English. */
  readonly translate?: Translate;
  /** The language `translate` speaks, for the page's `lang`. Default 'en'. */
  readonly lang?: string;
  /** After a timeout, how long a late browser is told so. Default 5 minutes (tests: less). */
  readonly lateWindowMs?: number;
}

/** Refresh this long before the real expiry, as pi-ai does, so no request starts on a dying token. */
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What we keep per sign-in. `refresh` is the only long-lived secret; the id token is never stored. */
export interface ChatGPTCredential extends OAuthCredential {
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly accountLabel?: string;
}

/** How the browser that brought the code hears about a sign-in that failed after it. */
function exchangeOutcome(cause: unknown): CallbackOutcome {
  return cause instanceof SignInFlowError && cause.reason === 'cancelled' ? 'failed' : 'exchange_failed';
}

export function createChatGPTOAuth(options: ChatGPTSignInOptions = {}): OAuthAuth {
  const fetch: FetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const tokenUrl = options.tokenUrl ?? CHATGPT_SIGN_IN.tokenUrl;

  const toCredential = (
    token: TokenResponse,
    clientId: string,
    previous?: Partial<ChatGPTCredential>,
  ): ChatGPTCredential => {
    const scopes = (token.scope ?? previous?.scopes?.join(' ') ?? '').split(/\s+/).filter(Boolean);
    if (!scopes.includes(CHATGPT_SIGN_IN.requiredScope))
      throw new SignInFlowError('rejected', `The grant lacks ${CHATGPT_SIGN_IN.requiredScope}.`);
    const refresh = token.refresh_token ?? previous?.refresh;
    if (!refresh) throw new SignInFlowError('invalid_response', 'The token response has no refresh_token.');
    const accountLabel = emailFromIdToken(token.id_token) ?? previous?.accountLabel;
    return {
      type: 'oauth',
      access: token.access_token,
      refresh,
      // Date.now, not an injected clock: pi-ai compares against Date.now when it decides to refresh.
      expires: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
      clientId,
      scopes,
      ...(accountLabel ? { accountLabel } : {}),
    };
  };

  /** The last sign-in's callback server, which may still be telling a late browser it timed out. */
  let previous: LoopbackCallback | undefined;

  async function login(interaction: ProviderAuthInteraction, login?: LoginOptions): Promise<OAuthCredential> {
    const deviceId = login?.getDeviceId?.();
    if (!deviceId || !UUID.test(deviceId))
      throw new SignInFlowError('invalid_response', 'Sign in with ChatGPT needs a UUID device id.');
    const { verifier, challenge } = createPkce();
    const state = randomToken();
    // This sign-in needs the port more than a late browser needs the old one's page.
    await previous?.close();
    const callback = await startLoopbackCallback({
      port: options.callbackPort ?? CHATGPT_SIGN_IN.callbackPort,
      path: CHATGPT_SIGN_IN.callbackPath,
      expectedState: state,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: interaction.signal,
      ...(options.translate ? { translate: options.translate } : {}),
      ...(options.lang ? { lang: options.lang } : {}),
      ...(options.lateWindowMs !== undefined ? { lateWindowMs: options.lateWindowMs } : {}),
    });
    previous = callback;
    try {
      const url = new URL(options.authorizeUrl ?? CHATGPT_SIGN_IN.authorizeUrl);
      url.search = new URLSearchParams({
        client_id: CHATGPT_SIGN_IN.registrationClientId,
        agent_name_hint: login?.agentName ?? 'Taalcut',
        ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
        response_type: 'code',
        redirect_uri: callback.redirectUri,
        resource: CHATGPT_SIGN_IN.resource,
        scope: CHATGPT_SIGN_IN.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        nonce: randomToken(),
      }).toString();
      interaction.notify({ type: 'auth_url', url: url.toString() });

      const params = await callback.result;
      const clientId = params.get('client_id')?.trim();
      if (!clientId) throw new SignInFlowError('invalid_response', 'The callback had no issued client_id.');
      interaction.notify({ type: 'progress', message: 'exchanging' });
      const token = await requestToken(
        fetch,
        tokenUrl,
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code: params.get('code') ?? '',
          code_verifier: verifier,
          redirect_uri: callback.redirectUri,
          resource: CHATGPT_SIGN_IN.resource,
        },
        interaction.signal,
      );
      if (!token.id_token)
        throw new SignInFlowError('invalid_response', 'The token response has no id_token.');
      const credential = toCredential(token, clientId);
      callback.respond('signed_in');
      return credential;
    } catch (cause) {
      // Only the browser that brought the code is still waiting: tell it why nothing was kept.
      callback.respond(exchangeOutcome(cause));
      throw cause;
    } finally {
      callback.release();
    }
  }

  async function refresh(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
    const stored = credential as Partial<ChatGPTCredential> & OAuthCredential;
    if (typeof stored.clientId !== 'string' || !stored.clientId)
      throw new SignInFlowError('rejected', 'The stored sign-in has no issued client id.');
    const token = await requestToken(
      fetch,
      tokenUrl,
      {
        grant_type: 'refresh_token',
        client_id: stored.clientId,
        refresh_token: stored.refresh,
        resource: CHATGPT_SIGN_IN.resource,
      },
      signal,
    );
    return toCredential(token, stored.clientId, stored);
  }

  return {
    name: 'ChatGPT',
    isSubscription: true,
    loginLabel: 'Continue with ChatGPT',
    login,
    refresh,
    toAuth: async (credential) => ({ apiKey: credential.access }),
  };
}
