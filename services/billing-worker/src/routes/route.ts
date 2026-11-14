// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type BillingDeps } from '../deps';
import { fail } from '../http/respond';

/** One endpoint. Each route module exports its own; index.ts lists the modules. */
export interface Route {
  readonly method: 'GET' | 'POST';
  /** The whole path. */
  readonly path: string;
  handle(request: Request, deps: BillingDeps): Promise<Response>;
}

/** The route whose method and path match, or 404 `billing.not_found`. */
export function dispatch(routes: readonly Route[], request: Request, deps: BillingDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const route = routes.find((entry) => entry.method === method && entry.path === path);
  return route ? route.handle(request, deps) : Promise.resolve(fail('billing.not_found', 404));
}
