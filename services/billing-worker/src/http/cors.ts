// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The website is the only page that may read this API's answers. An origin on the list gets the headers that let
 * its page read them; any other origin gets none, and its browser refuses the answer. This is not what keeps an
 * order honest (prices and payments are checked on the server): it only keeps other sites' pages out.
 */

/** The headers for `request`'s origin, or none when it is not on the list. */
export function corsHeaders(request: Request, allowed: ReadonlySet<string>): Record<string, string> {
  const origin = request.headers.get('origin');
  if (origin === null || !allowed.has(origin)) return {};
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}

/** The answer to a browser's preflight for a JSON POST. */
export function preflight(request: Request, allowed: ReadonlySet<string>): Response {
  const headers = new Headers(corsHeaders(request, allowed));
  if (headers.has('access-control-allow-origin')) {
    headers.set('access-control-allow-methods', 'GET, POST');
    headers.set('access-control-allow-headers', 'content-type');
    headers.set('access-control-max-age', '600');
  }
  return new Response(null, { status: 204, headers });
}

/** `response` with `extra` added. The route's own headers win. */
export function withHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
