// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  FILM_HOSTS,
  FIREBASE_HOSTS,
  inlineScripts,
  isDeployed,
  NOT_DEPLOYED,
  pageHashes,
  pagePath,
  pageRegex,
  runs,
  scriptHash,
  withCsp,
  type HostingTemplate,
} from '#lib/firebase/hosting-csp';

/** A page shaped like Next's export: the theme's boot script, JSON-LD, Turbopack's chunk list, flight data. */
const FIXTURE = `<!DOCTYPE html><html lang="en" data-theme="light"><head>
<script src="/_next/static/chunks/a.js" async=""></script>
<script>((a,b)=>{let i=document.documentElement;i.setAttribute(a,b)})("data-theme","light")</script>
</head><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
<script id="_R_">(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":[]})</script>
<script>(self.__next_f=self.__next_f||[]).push([0])</script>
<SCRIPT type='module'>self.__next_f.push([1,"0:\\"$L1\\"\\n"])</SCRIPT>
<script type="text/javascript" >console.log("é – unicode");</script >
<script nomodule src="/_next/static/chunks/polyfills.js"></script>
</body></html>`;

const csp = (hashes: string[]) => buildCsp(hashes, { firebase: true });
const directive = (policy: string, name: string) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `) || d === name);

describe('the inline script hasher', () => {
  it('matches the CSP specification’s own example', () => {
    // CSP Level 3, "hash-source": <script>alert('Hello, world.');</script>
    expect(scriptHash("alert('Hello, world.');")).toBe(
      "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='",
    );
  });

  it('finds every inline script, skips scripts with a src, and keeps the body byte for byte', () => {
    const found = inlineScripts(FIXTURE);
    expect(found).toHaveLength(6);
    expect(found.map((s) => s.type)).toEqual([
      null,
      'application/ld+json',
      null,
      null,
      'module',
      'text/javascript',
    ]);
    expect(found[5]!.body).toBe('console.log("é – unicode");');
  });

  it('allows every script that runs, and only those', () => {
    const scripts = inlineScripts(FIXTURE);
    const policy = csp(pageHashes(FIXTURE));
    const scriptSrc = directive(policy, 'script-src')!;
    for (const script of scripts) {
      expect(scriptSrc.includes(scriptHash(script.body)), script.body.slice(0, 40)).toBe(runs(script));
    }
    expect(pageHashes(FIXTURE)).toHaveLength(5);
  });

  it('hashes the UTF-8 bytes, as the browser does, for a script that isn’t ASCII', async () => {
    const body = 'console.log("é – unicode");';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    expect(scriptHash(body)).toBe(`'sha256-${Buffer.from(digest).toString('base64')}'`);
  });
});

describe('the policy', () => {
  it('allows nothing it does not need', () => {
    const policy = csp(["'sha256-x'"]);
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'script-src')).toBe(
      `script-src 'self' 'sha256-x' ${FIREBASE_HOSTS.script.join(' ')}`,
    );
    expect(directive(policy, 'connect-src')).toBe(`connect-src 'self' ${FIREBASE_HOSTS.connect.join(' ')}`);
    expect(directive(policy, 'frame-src')).toBe(`frame-src ${FIREBASE_HOSTS.frame.join(' ')} ${FILM_HOSTS.frame.join(' ')}`);
    for (const fixed of [
      "img-src 'self' data:",
      "font-src 'self'",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ]) {
      expect(policy.split('; ')).toContain(fixed);
    }
    expect(policy).not.toMatch(/unsafe-eval|strict-dynamic|\*/);
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline');
  });

  it('allows no Firebase or reCAPTCHA host in a build without config', () => {
    const policy = buildCsp([], { firebase: false });
    expect(policy.replace(FILM_HOSTS.frame.join(' '), '')).not.toMatch(/google|gstatic|firestore|firebase/);
    expect(directive(policy, 'frame-src')).toBe(`frame-src ${FILM_HOSTS.frame.join(' ')}`);
  });
});

describe('the hosting config', () => {
  const template = JSON.parse(
    readFileSync(new URL('../../firebase/firebase.template.json', import.meta.url), 'utf8'),
  ) as HostingTemplate & {
    hosting: Record<string, unknown> & {
      redirects: { regex: string; destination: string; type: number }[];
      ignore: string[];
    };
  };

  it('deploys 404.html but not the /404/ and /_not-found/ copies Next writes, which would answer 200', () => {
    expect(NOT_DEPLOYED).toEqual(['404', '_not-found']);
    for (const dir of NOT_DEPLOYED) expect(template.hosting.ignore).toContain(`${dir}/**`);
    expect(template.hosting.ignore.some((glob) => glob.includes('404.html'))).toBe(false);
    expect(isDeployed('website/out/404.html')).toBe(true);
    expect(isDeployed('out/404/index.html')).toBe(false);
    expect(isDeployed('out/_not-found/index.html')).toBe(false);
    expect(isDeployed('out/waitlist/index.html')).toBe(true);
    expect(isDeployed('out/features/404-ideas/index.html')).toBe(true);
  });

  it('keeps every header rule, redirect and ignore of the template once the policy is written in', () => {
    const config = withCsp(template, [{ path: '/', hashes: ["'sha256-home'"] }], { firebase: true });
    const { headers, ...rest } = config.hosting;
    const { headers: templateHeaders, ...templateRest } = template.hosting;
    expect(rest).toEqual(templateRest);
    for (const rule of templateHeaders) {
      const kept = headers.find((r) => r.source === rule.source);
      expect(kept, rule.source).toBeDefined();
      for (const header of rule.headers) expect(kept!.headers, rule.source).toContainEqual(header);
    }
    expect(config.firestore).toEqual(template.firestore);
  });

  it('serves the export with slashes, the custom 404 and the old language addresses redirected', () => {
    expect(template.hosting).toMatchObject({ public: '../out', trailingSlash: true, cleanUrls: false });
    // Firebase's regex redirects take RE2's (?P<name>); JavaScript spells it (?<name>).
    const rules = template.hosting.redirects.map((r) => ({
      ...r,
      re: new RegExp(r.regex.replace('(?P<', '(?<')),
    }));
    const follow = (path: string) => {
      const rule = rules.find((r) => r.re.test(path));
      if (!rule) return null;
      const rest = rule.re.exec(path)?.groups?.rest ?? '';
      return { to: rule.destination.replace(':rest', rest), type: rule.type };
    };
    expect(follow('/hi/beta-terms/')).toEqual({ to: '/beta-terms/', type: 301 });
    expect(follow('/pt-br/about/')).toEqual({ to: '/about/', type: 301 });
    expect(follow('/es')).toEqual({ to: '/', type: 301 });
    expect(follow('/hi/')).toEqual({ to: '/', type: 301 });
    expect(follow('/history/')).toBeNull();
    expect(follow('/hindi/')).toBeNull();
  });

  it('sends the security headers everywhere and caches what is fingerprinted', () => {
    const all = template.hosting.headers.find((r) => r.source === '**')!.headers.map((h) => h.key);
    expect(all).toEqual(
      expect.arrayContaining([
        'Strict-Transport-Security',
        'Referrer-Policy',
        'X-Content-Type-Options',
        'Permissions-Policy',
        'Cross-Origin-Opener-Policy',
      ]),
    );
    const cache = (source: string) =>
      template.hosting.headers.find((r) => r.source === source)?.headers[0]?.value;
    expect(cache('/_next/static/**')).toBe('public, max-age=31536000, immutable');
    expect(cache('/media/**')).toMatch(/max-age=\d{7,}/);
    expect(cache('/brand/**')).toMatch(/max-age=\d{7,}/);
  });

  it('writes each page its own policy after a catch-all that allows every page’s scripts', () => {
    const pages = [
      { path: '/', hashes: ["'sha256-home'"] },
      { path: '/waitlist/', hashes: ["'sha256-wait'"] },
      { path: null, hashes: ["'sha256-404'"] },
    ];
    const config = withCsp(template, pages, { firebase: true });
    const rules = config.hosting.headers;
    const catchAll = rules
      .find((r) => r.source === '**')!
      .headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    for (const h of ["'sha256-home'", "'sha256-wait'", "'sha256-404'"]) expect(catchAll).toContain(h);
    const own = rules.filter((r) => r.regex);
    expect(own.map((r) => r.regex)).toEqual([pageRegex('/'), pageRegex('/waitlist/')]);
    const waitlist = own[1]!.headers[0]!.value;
    expect(waitlist).toContain("'sha256-wait'");
    expect(waitlist).not.toContain("'sha256-home'");
    // The page rules come after the catch-all, so a host that lets the later rule win sends the page's own policy.
    expect(rules.indexOf(own[0]!)).toBeGreaterThan(rules.findIndex((r) => r.source === '**'));
  });

  it('maps exported files to addresses, and an address to the rule that matches it', () => {
    expect(pagePath('out/index.html')).toBe('/');
    expect(pagePath('website/out/features/agent/index.html')).toBe('/features/agent/');
    expect(pagePath('out/404.html')).toBeNull();
    const re = new RegExp(pageRegex('/features/agent/'));
    expect(re.test('/features/agent/')).toBe(true);
    expect(re.test('/features/agent/index.html')).toBe(true);
    expect(re.test('/features/agent/x/')).toBe(false);
    expect(new RegExp(pageRegex('/')).test('/about/')).toBe(false);
  });
});
