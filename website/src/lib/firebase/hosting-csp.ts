// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createHash } from 'node:crypto';

/**
 * The Content-Security-Policy Firebase Hosting sends, built from the exported HTML (scripts/csp.mjs runs it after
 * `next build`). Every inline script that runs (Next's flight data and chunk list, next-themes' boot script) is
 * allowed by its SHA-256, page by page; nothing inline runs otherwise. Build-time only: never imported by a page.
 */

/**
 * The launch film's player on the home page (2026-11-07): YouTube's privacy-enhanced host, framed only after the
 * visitor presses play (components/home/launch-film.tsx). Every build allows it, closed or live.
 */
export const FILM_HOSTS = { frame: ['https://www.youtube-nocookie.com'] } as const;

/** Hosts the forms reach in a build with Firebase config. A closed build allows none of them. */
export const FIREBASE_HOSTS = {
  /** reCAPTCHA Enterprise's loader and its code (Google's CSP guidance for reCAPTCHA). */
  script: ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
  /** Firestore's REST endpoint, App Check's token exchange, and reCAPTCHA's own calls. */
  connect: [
    'https://firestore.googleapis.com',
    'https://content-firebaseappcheck.googleapis.com',
    'https://www.google.com/recaptcha/',
  ],
  /** reCAPTCHA's invisible frame. */
  frame: ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
} as const;

/**
 * Hosts Analytics reaches in a build with a measurement id: Google's CSP guidance for Analytics without advertising
 * features (developers.google.com/tag-platform/security/guides/csp), plus the two Firebase endpoints the Analytics SDK
 * calls itself (its web config, and the installation id it tags hits with).
 */
export const ANALYTICS_HOSTS = {
  script: ['https://www.googletagmanager.com'],
  connect: [
    'https://www.googletagmanager.com',
    'https://*.google-analytics.com',
    'https://*.google.com',
    'https://firebase.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
  ],
  img: ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
} as const;

/** What the policy allows beyond the site itself. */
export interface CspOptions {
  /** The forms' Firebase hosts (a live or emulator build's config, live only in production). */
  readonly firebase: boolean;
  /** Analytics' hosts (a live build with a measurement id). Optional: absent means none. */
  readonly analytics?: boolean;
  /**
   * The billing service's origin (lib/billing/origin.ts › billingOrigin), which /premium/ asks for a quote and sends
   * an order to. On every page, not only /premium/: a visitor who moves there inside the site keeps the policy of the
   * page they arrived on. Null or absent adds nothing (a test build that reaches billing on the site's own origin).
   * The payment page itself needs no entry: the browser goes there by a top-level navigation, which no directive of
   * this policy governs (`form-action` is for forms, and the order form posts nowhere).
   */
  readonly billing?: string | null;
}

export interface InlineScript {
  /** The `type` attribute as written, or null when there is none. */
  readonly type: string | null;
  /** The text between the tags, byte for byte: what the browser hashes. */
  readonly body: string;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTR_TYPE = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ATTR_SRC = /\bsrc\s*=/i;

/** Every `<script>` in a page that has no `src`. */
export function inlineScripts(html: string): InlineScript[] {
  const found: InlineScript[] = [];
  for (const m of html.matchAll(SCRIPT)) {
    const attrs = m[1] ?? '';
    if (ATTR_SRC.test(attrs)) continue;
    const t = ATTR_TYPE.exec(attrs);
    found.push({ type: t ? (t[1] ?? t[2] ?? t[3] ?? '') : null, body: m[2] ?? '' });
  }
  return found;
}

const JS_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
]);

/**
 * Whether the browser runs it. A data block (JSON-LD's `application/ld+json`) is never executed, so script-src
 * doesn't govern it and it needs no hash.
 */
export function runs(script: InlineScript): boolean {
  return script.type === null || JS_TYPES.has(script.type.trim().toLowerCase());
}

/** The CSP source for a script body: `'sha256-<base64>'` over its UTF-8 bytes. */
export function scriptHash(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

/** The sorted, de-duplicated hashes of a page's scripts that run. */
export function pageHashes(html: string): string[] {
  return [
    ...new Set(
      inlineScripts(html)
        .filter(runs)
        .map((s) => scriptHash(s.body)),
    ),
  ].sort();
}

/**
 * The policy. `style-src` keeps 'unsafe-inline': the exported HTML carries style attributes (Kaatu's box, motion's
 * first frame) and motion/react inserts a <style> element for popLayout at run time; neither can be hashed.
 */
export function buildCsp(hashes: readonly string[], options: CspOptions): string {
  const hosts = options.firebase ? FIREBASE_HOSTS : { script: [], connect: [], frame: [] };
  const counted = options.analytics ? ANALYTICS_HOSTS : { script: [], connect: [], img: [] };
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", ...hashes, ...hosts.script, ...counted.script],
    [
      'connect-src',
      "'self'",
      ...hosts.connect,
      ...counted.connect,
      ...(options.billing ? [options.billing] : []),
    ],
    ['frame-src', ...hosts.frame, ...FILM_HOSTS.frame],
    ['img-src', "'self'", 'data:', ...counted.img],
    ['font-src', "'self'"],
    ['media-src', "'self'"],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['upgrade-insecure-requests'],
  ];
  return directives.map((d) => d.join(' ')).join('; ');
}

/**
 * Export folders Hosting doesn't deploy. Next writes `/404/` and `/_not-found/` beside `404.html`, and Hosting would
 * serve them as pages that answer 200. firebase.template.json's `ignore` lists the same folders (`404/**`); `404.html`
 * stays, and Hosting sends it with a 404 for every unknown path.
 */
export const NOT_DEPLOYED = ['404', '_not-found'] as const;

/** Whether an exported file is deployed: false under a NOT_DEPLOYED folder, so no CSP rule is written for it. */
export function isDeployed(file: string): boolean {
  const rel = file.replace(/\\/g, '/').replace(/^.*?\bout\//, '');
  return !NOT_DEPLOYED.some((dir) => rel.startsWith(`${dir}/`));
}

/** `out/features/agent/index.html` → `/features/agent/`; `out/404.html` → null (served for every unknown path). */
export function pagePath(file: string): string | null {
  const rel = file.replace(/\\/g, '/').replace(/^.*?\bout\//, '');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return null;
}

/** A Firebase Hosting `regex` source for one page: its slash address and its index.html. */
export function pageRegex(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}(index\\.html)?$`;
}

export interface HeaderRule {
  readonly source?: string;
  readonly regex?: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

export interface HostingTemplate {
  readonly hosting: { readonly headers: readonly HeaderRule[] } & Record<string, unknown>;
  readonly [key: string]: unknown;
}

/** An exported HTML file's hashes, and its address (null for 404.html, which has no address of its own). */
export interface PageScripts {
  readonly path: string | null;
  readonly hashes: readonly string[];
}

/**
 * The template with the CSP written in. The catch-all `**` rule carries a policy that allows every page's scripts
 * (it is what the 404 and any file outside a page get); each page's own rule follows it with only that page's
 * hashes. Either way Hosting resolves two rules for one path, a page's scripts are allowed and nothing else is.
 */
export function withCsp(
  template: HostingTemplate,
  pages: readonly PageScripts[],
  options: CspOptions,
): HostingTemplate {
  const all = [...new Set(pages.flatMap((p) => p.hashes))].sort();
  const csp = (hashes: readonly string[]) => ({
    key: 'Content-Security-Policy',
    value: buildCsp(hashes, options),
  });
  const headers = template.hosting.headers.map((rule) =>
    rule.source === '**'
      ? { ...rule, headers: [...rule.headers.filter((h) => h.key !== 'Content-Security-Policy'), csp(all)] }
      : rule,
  );
  if (!headers.some((rule) => rule.source === '**'))
    throw new Error('firebase.template.json needs a "**" header rule');
  const perPage = pages
    .flatMap((p) => (p.path === null ? [] : [{ path: p.path, hashes: p.hashes }]))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((p): HeaderRule => ({ regex: pageRegex(p.path), headers: [csp(p.hashes)] }));
  return { ...template, hosting: { ...template.hosting, headers: [...headers, ...perPage] } };
}
