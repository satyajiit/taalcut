// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type HubDeps } from '../deps';
import { fail } from '../http/respond';

/** One endpoint. Each route module exports its own; index.ts lists the modules. */
export interface Route {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The whole path; one capture group at most, URI-decoded and passed on as `param`. */
  readonly path: RegExp;
  handle(request: Request, deps: HubDeps, param: string): Promise<Response>;
}

/** The first route whose method and path match, or 404 `hub.not_found`. */
export function dispatch(routes: readonly Route[], request: Request, deps: HubDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  for (const route of routes) {
    if (route.method !== method) continue;
    const found = route.path.exec(path);
    if (!found) continue;
    const param = decoded(found[1] ?? '');
    if (param === null) break;
    return route.handle(request, deps, param);
  }
  return Promise.resolve(fail('hub.not_found', 404));
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape names no resource: the request is a 404.
    return null;
  }
}
