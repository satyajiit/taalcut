// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../src/app/manifest';
import robots from '../../src/app/robots';
import sitemap from '../../src/app/sitemap';
import { claimViolations } from '#content/claims';
import { ABOUT, JHAPTAAL } from '#content/about';
import { PRESS } from '#content/press';
import { FAQ, FAQ_GROUPS, faqGroupId } from '#content/faq';
import { BETA_TERMS, PRIVACY, PRIVACY_GIST, TERMS } from '#content/legal';
import { HOME_STORY, LLMS, MIRROR_LINES } from '#content/llms';
import { PAGES } from '#content/pages';
import { PLATFORM_GETS } from '#content/platforms';
import { AI_STICKERS, API_KEYS, CHATGPT, LOCAL_ONLY, ON_DEVICE, OWN_SERVER, PROFILE_ON_UBUNTU, PROFILES, PROFILES_DEMO, PROVIDER_GRID } from '#content/providers';
import { LICENCE_LINE, SITE, TRADEMARK_POLICY } from '#content/site';
import { AI_CRAWLERS } from '#lib/llms/crawlers';
import { listedPages } from '#lib/llms/mirror';
import { absolute } from '#lib/seo';
import { SITE_ROOT, read } from './source-files';

/** Every string value in a content object, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/** The content pages' words beside the foundation's modules (claims.test.ts scans those): WEB1's L4, now WEB2's L6. */
const L4_CONTENT = [
  ABOUT,
  JHAPTAAL,
  PRESS,
  PRIVACY,
  PRIVACY_GIST,
  TERMS,
  BETA_TERMS,
  LLMS,
  HOME_STORY,
  MIRROR_LINES,
  CHATGPT,
  API_KEYS,
  ON_DEVICE,
  LOCAL_ONLY,
  OWN_SERVER,
  PROVIDER_GRID,
  PROFILES_DEMO,
  AI_STICKERS,
  PROFILES,
  PROFILE_ON_UBUNTU,
  PLATFORM_GETS,
  LICENCE_LINE,
  TRADEMARK_POLICY,
];

describe('robots.txt', () => {
  const rules = robots();
  const list = Array.isArray(rules.rules) ? rules.rules : [rules.rules];

  it('allows everyone and names every AI crawler, each allowed', () => {
    expect(list).toContainEqual({ userAgent: '*', allow: '/' });
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) {
      expect(list, bot).toContainEqual({ userAgent: bot, allow: '/' });
    }
    expect(list.some((r) => 'disallow' in r && r.disallow)).toBe(false);
    expect(AI_CRAWLERS).toHaveLength(10);
  });

  it('points to the sitemap', () => {
    expect(rules.sitemap).toBe(absolute('/sitemap.xml'));
  });
});

describe('sitemap.xml', () => {
  it('equals PAGES, less the unlisted', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual(PAGES.filter((p) => !p.unlisted).map((p) => absolute(p.path)));
    expect(new Set(urls).size).toBe(urls.length);
    for (const entry of sitemap()) expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('manifest.webmanifest', () => {
  it('names the site, opens in the browser and uses the kit’s web icons', () => {
    const m = manifest();
    expect(m).toMatchObject({ name: SITE.name, short_name: SITE.name, start_url: '/', display: 'browser', theme_color: SITE.themeColor.light });
    expect(m.icons?.map((i) => i.src)).toEqual(['/brand/icon-192.png', '/brand/icon-512.png', '/brand/maskable-512.png']);
    for (const icon of m.icons ?? []) expect(existsSync(join(SITE_ROOT, '..', 'design/logo/kit/web', icon.src.replace('/brand/', ''))), icon.src).toBe(true);
  });
});

describe('the FAQ', () => {
  it('has unique ids that work as anchors', () => {
    const ids = FAQ.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(ids).toContain('footage-leaves');
  });

  it('shows every group, each with its own anchor', () => {
    expect(new Set(FAQ.map((e) => e.group))).toEqual(new Set(FAQ_GROUPS));
    const groupIds = FAQ_GROUPS.map(faqGroupId);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    for (const id of groupIds) expect(ids(id)).toBe(false);
  });
});

function ids(id: string): boolean {
  return FAQ.some((e) => e.id === id);
}

describe('L4’s words', () => {
  it('hold to the truth ledger', () => {
    expect(strings(L4_CONTENT).flatMap(claimViolations)).toEqual([]);
  });

  it('link only to pages and anchors that exist', () => {
    const paths = new Set(listedPages().map((p) => p.path));
    for (const text of strings(L4_CONTENT)) {
      for (const [, href] of text.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const [path, hash] = href!.split('#');
        expect(paths.has(path!), href).toBe(true);
        if (path === '/faq/' && hash) expect(ids(hash), href).toBe(true);
      }
    }
  });

  it('keep the subscription sign-ins the ledger leaves out off the AI page', () => {
    const ai = read('src/app/ai/page.tsx') + strings([CHATGPT, API_KEYS, ON_DEVICE, LOCAL_ONLY, OWN_SERVER]).join('\n');
    expect(ai).not.toMatch(/claude pro|claude max|copilot|grok|supergrok/i);
  });
});

describe('security.txt', () => {
  const txt = read('public/.well-known/security.txt');

  it('has the fields RFC 9116 asks for', () => {
    expect(txt).toMatch(/^Contact: mailto:admin@matterwardlabs\.com$/m);
    expect(txt).toMatch(/^Preferred-Languages: en$/m);
    expect(txt).toMatch(/^Canonical: https:\/\/taalcut\.app\/\.well-known\/security\.txt$/m);
  });

  it('has not lapsed, and is renewed a month before it does', () => {
    const expires = Date.parse(/^Expires: (.+)$/m.exec(txt)?.[1] ?? '');
    expect(expires - Date.now()).toBeGreaterThan(30 * 24 * 3600 * 1000);
    expect(expires - Date.now()).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
  });
});
