// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The real phone page through the real server: every file it needs is served with its type under the page's
// CSP (fonts included), and its own files never count against the unauthenticated limit, so reloading the page
// can't lock a phone out of its scripts and fonts. The page itself, ping and pair still count.
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TRANSFER_LIMITS } from '../../src/limits';
import { PHONE_LOCALES, PHONE_PAGE_FILES, phoneAssetsFromDir } from '../../src/phone-assets';
import { httpCall, startFixture, type Fixture } from '../support/harness';

const PHONE_DIR = fileURLToPath(new URL('../../phone/', import.meta.url));

describe('the phone page on the server', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('serves every file the page lists, the catalogs and tus-js-client, each with its type', async () => {
    fx = await startFixture({ phoneAssets: phoneAssetsFromDir(PHONE_DIR) });
    const names = [
      ...PHONE_PAGE_FILES.filter(([name]) => name !== 'index.html'),
      ...PHONE_LOCALES.map((locale) => [`${locale}.json`, '', 'application/json; charset=utf-8'] as const),
    ];
    for (const [name, , type] of names) {
      const reply = await httpCall({ host: fx.address, port: fx.port, path: `/assets/${name}` });
      expect(reply.status, name).toBe(200);
      expect(reply.headers['content-type'], name).toBe(type);
    }
    const tus = await httpCall({ host: fx.address, port: fx.port, path: '/assets/tus.min.js' });
    expect(tus.status).toBe(200);
    expect(tus.body.length).toBeGreaterThan(10_000);
  });

  it('answers at the address the Mac shows for typing, the origin alone (/)', async () => {
    fx = await startFixture({ phoneAssets: phoneAssetsFromDir(PHONE_DIR) });
    const page = await httpCall({ host: fx.address, port: fx.port, path: '/' });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.body).toContain('id="pin"');
    expect(page.body).toContain('id="code"');
  });

  it("lets the page load its own fonts and nothing from elsewhere (font-src 'self')", async () => {
    fx = await startFixture({ phoneAssets: phoneAssetsFromDir(PHONE_DIR) });
    const page = await httpCall({ host: fx.address, port: fx.port, path: '/' });
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/https?:|\*/);
    const font = await httpCall({ host: fx.address, port: fx.port, path: '/assets/onest-latin.woff2' });
    expect(font.headers['content-type']).toBe('font/woff2');
    expect(font.headers['content-security-policy']).toBe(csp);
  });

  it("doesn't count the page's own files against the unauthenticated limit, but still counts the page", async () => {
    fx = await startFixture({ phoneAssets: phoneAssetsFromDir(PHONE_DIR) });
    const reloads = TRANSFER_LIMITS.unauthPerMinute * 2;
    for (let index = 0; index < reloads; index += 1) {
      const asset = await httpCall({ host: fx.address, port: fx.port, path: '/assets/app.js' });
      expect(asset.status, `asset request ${index + 1}`).toBe(200);
    }
    const statuses: number[] = [];
    for (let index = 0; index <= TRANSFER_LIMITS.unauthPerMinute; index += 1) {
      statuses.push((await httpCall({ host: fx.address, port: fx.port, path: '/' })).status);
    }
    expect(statuses.slice(0, TRANSFER_LIMITS.unauthPerMinute).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('answers a name outside the map with an empty 404, whatever its encoding', async () => {
    fx = await startFixture({ phoneAssets: phoneAssetsFromDir(PHONE_DIR) });
    for (const path of ['/assets/nope.js', '/assets/fonts%2Fonest-latin-wght-normal.woff2', '/assets/']) {
      const reply = await httpCall({ host: fx.address, port: fx.port, path });
      expect(reply.status, path).toBe(404);
      expect(reply.body, path).toBe('');
    }
  });
});
