// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the billing service is. A deployed build always uses BILLING_DEFAULT. NEXT_PUBLIC_BILLING_URL replaces it at
 * build time for tests only: an absolute address, or a path on the site itself (`/__billing`), so a test build sends
 * nothing off the machine. scripts/csp.mjs reads this file as it is (Node's type stripping), so it imports nothing
 * and holds only erasable TypeScript.
 */
export const BILLING_ENV_KEY = 'NEXT_PUBLIC_BILLING_URL';
export const BILLING_DEFAULT = 'https://billing.taalcut.app';

/** The base address every billing request starts with, without a trailing slash. */
export function billingBase(override: string | undefined = process.env.NEXT_PUBLIC_BILLING_URL): string {
  const value = override?.trim();
  return (value && value.length > 0 ? value : BILLING_DEFAULT).replace(/\/+$/, '');
}

/** Whether this build talks to anything but the real billing service: a test build, never deployed. */
export function billingOverridden(
  override: string | undefined = process.env.NEXT_PUBLIC_BILLING_URL,
): boolean {
  return billingBase(override) !== BILLING_DEFAULT;
}

/**
 * The origin the Content-Security-Policy must let the page connect to, or null when the base is a path on the site
 * itself (which `'self'` already covers).
 */
export function billingOrigin(base: string = billingBase()): string | null {
  if (!/^https?:\/\//i.test(base)) return null;
  try {
    return new URL(base).origin;
  } catch {
    // Not an address: nothing to allow.
    return null;
  }
}
