// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A local stand-in for auth.openai.com's Sign in with ChatGPT endpoints. The
 * authorize endpoint redirects straight back (the user "approves" at once) with
 * a code, the state and an issued client id; the token endpoint checks PKCE,
 * the redirect URI and the client, and rotates refresh tokens. Tokens are
 * opaque random strings, so only exact-value scrubbing can hide them.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface IssuedTokens {
  readonly access: string;
  readonly refresh: string;
  readonly idToken?: string;
}

export interface MockOAuthServer {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly authorizeRequests: URLSearchParams[];
  readonly tokenRequests: URLSearchParams[];
  readonly issued: IssuedTokens[];
  /** Every value a leak would expose: tokens, codes, PKCE verifiers. */
  secrets(): string[];
  isValidAccess(token: string | undefined): boolean;
  /** The provider stops accepting every access token issued so far (server-side expiry). */
  expireAccessTokens(): void;
  /** Every refresh token stops working (revoked, or the plan ended). */
  revokeRefreshTokens(): void;
  /** The next authorize request answers error=access_denied. */
  denyNext(): void;
  close(): Promise<void>;
}

const REQUIRED_SCOPE = 'chatgpt.tokens.use.direct';
export const ACCOUNT_EMAIL = 'ada@example.com';

export async function startMockOAuthServer(): Promise<MockOAuthServer> {
  const authorizeRequests: URLSearchParams[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const issued: IssuedTokens[] = [];
  const leakable: string[] = [];
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  const validAccess = new Set<string>();
  const validRefresh = new Map<string, string>(); // refresh token → client id
  let deny = false;
  let clients = 0;

  const token = (prefix: string) => {
    const value = `${prefix}_${randomBytes(18).toString('base64url')}`;
    leakable.push(value);
    return value;
  };

  function issue(clientId: string, withIdToken: boolean): Record<string, unknown> {
    const access = token('at');
    const refresh = token('rt');
    const claims = Buffer.from(JSON.stringify({ email: ACCOUNT_EMAIL, sub: 'user-1' })).toString('base64url');
    const idToken = withIdToken ? `${token('hdr')}.${claims}.${token('sig')}` : undefined;
    if (idToken) leakable.push(idToken);
    validAccess.add(access);
    validRefresh.set(refresh, clientId);
    issued.push({ access, refresh, ...(idToken ? { idToken } : {}) });
    return {
      access_token: access,
      refresh_token: refresh,
      ...(idToken ? { id_token: idToken } : {}),
      token_type: 'Bearer',
      scope: `openid profile email offline_access resource.invoke ${REQUIRED_SCOPE}`,
      expires_in: 3600,
    };
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  function authorize(url: URL, res: ServerResponse): void {
    const q = url.searchParams;
    authorizeRequests.push(q);
    const redirect = new URL(q.get('redirect_uri') ?? 'http://invalid');
    const state = q.get('state') ?? '';
    if (deny) {
      deny = false;
      redirect.search = new URLSearchParams({ error: 'access_denied', state }).toString();
    } else {
      const ok =
        q.get('client_id') === 'dynamic_agent_client' &&
        q.get('response_type') === 'code' &&
        q.get('code_challenge_method') === 'S256' &&
        (q.get('scope') ?? '').split(' ').includes(REQUIRED_SCOPE) &&
        /^urn:uuid:[0-9a-f-]{36}$/.test(q.get('ext_agent_host_id') ?? '');
      if (!ok) return json(res, 400, { error: 'invalid_request' });
      const code = token('code');
      const clientId = `issued-client-${++clients}`;
      codes.set(code, {
        challenge: q.get('code_challenge') ?? '',
        redirectUri: redirect.toString(),
        clientId,
      });
      redirect.search = new URLSearchParams({ code, state, client_id: clientId }).toString();
    }
    res.writeHead(302, { location: redirect.toString() });
    res.end();
  }

  function tokenEndpoint(form: URLSearchParams, res: ServerResponse): void {
    tokenRequests.push(form);
    if (form.get('resource') !== 'https://api.openai.com/v1')
      return json(res, 400, { error: 'invalid_target' });
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '';
      const grant = codes.get(code);
      codes.delete(code); // single use
      const verifier = form.get('code_verifier') ?? '';
      leakable.push(verifier);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (
        !grant ||
        grant.challenge !== challenge ||
        grant.redirectUri !== form.get('redirect_uri') ||
        grant.clientId !== form.get('client_id')
      )
        return json(res, 400, { error: 'invalid_grant', error_description: `bad code ${code}` });
      return json(res, 200, issue(grant.clientId, true));
    }
    if (form.get('grant_type') === 'refresh_token') {
      const refresh = form.get('refresh_token') ?? '';
      const clientId = validRefresh.get(refresh);
      if (!clientId || clientId !== form.get('client_id'))
        // Real servers echo the grant in descriptions; the client must not pass it on.
        return json(res, 400, {
          error: 'invalid_grant',
          error_description: `refresh token ${refresh} is invalid`,
        });
      validRefresh.delete(refresh); // rotation
      return json(res, 200, issue(clientId, false));
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/accounts/authorize') return authorize(url, res);
    if (req.method === 'POST' && url.pathname === '/api/accounts/oauth/token') {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part as Buffer);
      return tokenEndpoint(new URLSearchParams(Buffer.concat(parts).toString('utf8')), res);
    }
    json(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => json(res, 500, { error: 'server_error' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    authorizeUrl: `${base}/api/accounts/authorize`,
    tokenUrl: `${base}/api/accounts/oauth/token`,
    authorizeRequests,
    tokenRequests,
    issued,
    secrets: () => [...leakable],
    isValidAccess: (value) => value !== undefined && validAccess.has(value),
    expireAccessTokens: () => validAccess.clear(),
    revokeRefreshTokens: () => validRefresh.clear(),
    denyNext: () => {
      deny = true;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A stand-in for the system browser: follows the authorize redirect to the loopback callback. */
export function createFakeBrowser() {
  const opened: string[] = [];
  const pages: { status: number; html: string; headers: Headers }[] = [];
  return {
    opened,
    pages,
    async open(url: string): Promise<void> {
      opened.push(url);
      const authorize = await fetch(url, { redirect: 'manual' });
      const location = authorize.headers.get('location');
      if (!location) return;
      const callback = await fetch(location);
      pages.push({ status: callback.status, html: await callback.text(), headers: callback.headers });
    },
  };
}
