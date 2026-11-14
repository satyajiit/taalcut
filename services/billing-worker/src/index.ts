// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Worker's composition root. It reads the configuration, builds each request's dependencies and hands the
 * request to the route that matches. Nothing is kept between requests: the database is the only memory.
 */
import { billingConfig, type BillingConfig, type ProviderKeys } from './config/env';
import { type BillingDeps } from './deps';
import { corsHeaders, preflight, withHeaders } from './http/cors';
import { fail } from './http/respond';
import { logInfo } from './log';
import { createNotifier } from './notify/notifier';
import { sweep } from './orders/reconcile';
import { type PaymentProvider } from './razorpay/port';
import { createRestProvider } from './razorpay/rest';
import { checkoutRoutes } from './routes/checkout';
import { confirmRoutes } from './routes/confirm';
import { quoteRoutes } from './routes/quote';
import { dispatch, type Route } from './routes/route';
import { webhookRoutes } from './routes/webhook';
import { type BillingEnv } from './store/d1';

const ROUTES: readonly Route[] = [...quoteRoutes, ...checkoutRoutes, ...confirmRoutes, ...webhookRoutes];

/** The part of the runtime's context the Worker uses. */
export interface Lifetime {
  waitUntil(work: Promise<unknown>): void;
}

export interface BillingWorkerOptions {
  /** The payment provider for a key pair. Default: its REST API. */
  provider?: (keys: ProviderKeys) => PaymentProvider;
  /** Default: `fetch` (the REST client and the chat webhook). */
  fetch?: typeof fetch;
  now?: () => number;
}

export interface BillingWorker {
  fetch(request: Request, env: BillingEnv, ctx: Lifetime): Promise<Response>;
  scheduled(controller: unknown, env: BillingEnv, ctx: Lifetime): Promise<void>;
}

export function createBillingWorker(options: BillingWorkerOptions = {}): BillingWorker {
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const providerFor =
    options.provider ?? ((keys: ProviderKeys) => createRestProvider({ keys, fetch: fetchImpl }));

  function depsFor(env: BillingEnv, config: BillingConfig, ctx: Lifetime): BillingDeps {
    return {
      db: env.ORDERS,
      config,
      provider: config.provider ? providerFor(config.provider) : null,
      notifier: createNotifier({
        email: env.EMAIL,
        mail: config.mail,
        webhookUrl: config.notifyWebhookUrl,
        fetch: fetchImpl,
        planLabel: (plan) => config.catalog.plans[plan]?.label ?? plan,
      }),
      checkoutBurst: env.CHECKOUT_BURST,
      readBurst: env.READ_BURST,
      now,
      // A telling that fails is retried by the sweep; here it must only never become an unhandled rejection.
      defer: (work) => ctx.waitUntil(work.catch(() => undefined)),
    };
  }

  return {
    async fetch(request, env, ctx) {
      const config = readConfig(env);
      if (!config) return fail('billing.not_selling', 503);
      if (request.method === 'OPTIONS') return preflight(request, config.allowedOrigins);
      // A browser names the page a request comes from. A page that is not the website's may not place or
      // confirm an order; a caller that is not a browser (the provider's deliveries) names no page.
      const origin = request.headers.get('origin');
      if (request.method === 'POST' && origin !== null && !config.allowedOrigins.has(origin))
        return fail('billing.forbidden', 403);
      const cors = corsHeaders(request, config.allowedOrigins);
      try {
        return withHeaders(await dispatch(ROUTES, request, depsFor(env, config, ctx)), cors);
      } catch (error) {
        // A database failure or a broken invariant (a bug). Only the error's name and the path are logged:
        // names, addresses and keys never reach a log line.
        console.error(
          JSON.stringify({
            event: 'billing.fault',
            error: error instanceof Error ? error.name : 'unknown',
            route: `${request.method} ${new URL(request.url).pathname}`,
          }),
        );
        return withHeaders(fail('billing.busy', 500), cors);
      }
    },

    async scheduled(_controller, env, ctx) {
      const config = readConfig(env);
      if (!config) return;
      const result = await sweep(depsFor(env, config, ctx));
      if (result.looked > 0 || result.told > 0) logInfo('billing.sweep', result);
    },
  };
}

/** The configuration, or null when it is malformed in a way the reader itself did not expect. */
function readConfig(env: unknown): BillingConfig | null {
  try {
    return billingConfig(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'billing.config_fault',
        error: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return null;
  }
}

/** The deployed Worker. */
const worker: BillingWorker = createBillingWorker();
export default worker;
