// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The two-letter country Cloudflare saw the request come from, when it says. */
export function countryOf(request: Request): string | null {
  const cf: unknown = Reflect.get(request, 'cf');
  const country: unknown = typeof cf === 'object' && cf !== null ? Reflect.get(cf, 'country') : undefined;
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null;
}
