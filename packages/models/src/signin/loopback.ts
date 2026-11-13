// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The browser comes back here after a sign-in (RFC 8252 loopback redirect). A
 * plain node:http server on 127.0.0.1 waits for one GET with the right state.
 * Wrong-state requests get the "doesn't match" page but don't end the wait, so
 * a stale tab or another local page can't cancel a sign-in.
 *
 * The browser that brings the code waits for its page until the caller says
 * how the sign-in ended (`respond`), so "You're signed in" shows only once the
 * tokens are issued and a failed exchange says so (UX3-AGT). When the wait
 * times out, the server stays a while to tell a late browser so, instead of
 * leaving it on "can't connect". Pages are static (callback-page.ts).
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MODELS_MESSAGES_EN } from '../i18n/messages-en';
import { CALLBACK_PAGE_CSP, callbackPage, type CallbackOutcome, type Translate } from './callback-page';
import { SignInFlowError } from './oauth';

export {
  CALLBACK_OUTCOMES,
  CALLBACK_PAGE_CSP,
  callbackPage,
  callbackPageKeys,
  type CallbackOutcome,
  type Translate,
} from './callback-page';

export interface LoopbackOptions {
  /** 0 asks the OS for a free port. */
  readonly port: number;
  readonly path: string;
  readonly expectedState: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly translate?: Translate;
  /** The language `translate` speaks, for the page's `lang`. Default 'en'. */
  readonly lang?: string;
  /** After the wait times out, how long a late browser is still told so. Default 5 minutes. */
  readonly lateWindowMs?: number;
}

export interface LoopbackCallback {
  /** http://127.0.0.1:<port><path>, with the port actually bound. */
  readonly redirectUri: string;
  /** The callback's query parameters. Rejects with a SignInFlowError. That browser waits for `respond`. */
  readonly result: Promise<URLSearchParams>;
  /** Answers the browser that brought the code with the page for how the sign-in ended. Once. */
  respond(outcome: CallbackOutcome): void;
  /** The caller is done: stops now, unless the wait timed out, when late browsers are told so for a while. */
  release(): void;
  /** Stops now; a browser still waiting gets the "didn't finish" page. Resolves once the port is free. */
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const DEFAULT_LATE_WINDOW_MS = 5 * 60_000;
const STATUS: Readonly<Record<CallbackOutcome, number>> = {
  signed_in: 200,
  denied: 400,
  state_mismatch: 400,
  timeout: 408,
  exchange_failed: 502,
  failed: 400,
};

export async function startLoopbackCallback(options: LoopbackOptions): Promise<LoopbackCallback> {
  if (options.signal.aborted) throw new SignInFlowError('cancelled', 'Sign-in cancelled.');
  const t = options.translate ?? englishOnly;
  const page = (response: ServerResponse, outcome: CallbackOutcome, status = STATUS[outcome]) =>
    send(response, status, callbackPage(t, outcome, options.lang));
  let settled = false;
  /** What the flow's own browser was told, so a reload of that tab says the same. */
  let told: CallbackOutcome | undefined;
  /** The browser that brought the code, until `respond`. */
  let held: ServerResponse | undefined;
  let closing: Promise<void> | undefined;
  let lateTimer: NodeJS.Timeout | undefined;
  let resolveResult!: (params: URLSearchParams) => void;
  let rejectResult!: (error: SignInFlowError) => void;
  const result = new Promise<URLSearchParams>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Callers may close before awaiting; an unobserved rejection must not crash the process.
  result.catch(() => undefined);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${HOST}`);
    if (request.method !== 'GET' || url.pathname !== options.path) return page(response, 'failed', 404);
    if (!sameState(url.searchParams.get('state'), options.expectedState))
      return page(response, 'state_mismatch');
    // After the end: what the flow's browser was told (a reload, a late browser), never a second exchange.
    if (settled) return told ? page(response, told) : page(response, 'failed', 409);
    const error = url.searchParams.get('error');
    if (error) {
      const denied = error === 'access_denied';
      told = denied ? 'denied' : 'failed';
      page(response, told);
      return finish(
        new SignInFlowError(
          denied ? 'denied' : 'rejected',
          `The provider answered error=${error.slice(0, 60)}.`,
        ),
      );
    }
    if (!url.searchParams.get('code')) {
      told = 'failed';
      page(response, told);
      return finish(new SignInFlowError('invalid_response', 'The callback had no authorization code.'));
    }
    held = response;
    // A browser that gives up has nothing left to answer.
    response.once('close', () => {
      if (held === response) held = undefined;
    });
    finish(url.searchParams);
  });

  const timer = setTimeout(() => {
    finish(
      new SignInFlowError('timeout', 'Nobody finished the sign-in in the browser in time.', {
        seconds: Math.round(options.timeoutMs / 1000),
      }),
    );
  }, options.timeoutMs);
  // The sign-in's own deadline aborts with a timeout reason; anything else is a cancel.
  const onAbort = () => {
    const reason: unknown = options.signal.reason;
    finish(
      reason instanceof SignInFlowError ? reason : new SignInFlowError('cancelled', 'Sign-in cancelled.'),
    );
  };
  options.signal.addEventListener('abort', onAbort, { once: true });

  function respond(outcome: CallbackOutcome): void {
    const browser = held;
    held = undefined;
    if (!browser) return;
    told = outcome;
    page(browser, outcome);
  }

  function close(): Promise<void> {
    if (closing) return closing;
    clearTimeout(timer);
    clearTimeout(lateTimer);
    options.signal.removeEventListener('abort', onAbort);
    respond('failed');
    // Let a page just written flush before the connections go.
    closing = new Promise<void>((resolve) =>
      setImmediate(() => {
        server.close(() => resolve());
        // Browsers keep spare connections open; one of them could carry a later sign-in's callback.
        server.closeAllConnections();
      }),
    );
    return closing;
  }

  function release(): void {
    if (told !== 'timeout') void close();
  }

  /** The wait timed out: a late browser hears so for a while; then the port is free again. */
  function linger(): void {
    told = 'timeout';
    options.signal.removeEventListener('abort', onAbort);
    lateTimer = setTimeout(() => void close(), options.lateWindowMs ?? DEFAULT_LATE_WINDOW_MS);
    // Nothing waits on a late browser: neither the timer nor the server keeps the process alive.
    lateTimer.unref();
    server.unref();
  }

  function finish(outcome: URLSearchParams | SignInFlowError): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (!(outcome instanceof SignInFlowError)) return resolveResult(outcome);
    rejectResult(outcome);
    if (outcome.reason === 'timeout') linger();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', (cause: NodeJS.ErrnoException) => {
      void close();
      reject(
        cause.code === 'EADDRINUSE'
          ? new SignInFlowError('port_busy', `Port ${options.port} is in use.`, { port: options.port })
          : new SignInFlowError('network', `Could not listen for the sign-in callback: ${cause.code ?? ''}`),
      );
    });
    server.listen(options.port, HOST, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { redirectUri: `http://${HOST}:${port}${options.path}`, result, respond, release, close };
}

function sameState(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response: ServerResponse, status: number, html: string): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': CALLBACK_PAGE_CSP,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    connection: 'close',
  });
  response.end(html);
}

function englishOnly(key: string): string {
  return MODELS_MESSAGES_EN[key] ?? key;
}
