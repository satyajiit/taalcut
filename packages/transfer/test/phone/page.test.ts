// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone page's markup is a contract with its scripts (ids, templates), the catalogs (data-i18n keys), the
// server (the asset map, the CSP: no inline script or style) and the brief (the PIN as separate, named boxes
// with no frame around them). These checks fail a change that breaks any of them.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE_PAGE_FILES } from '../../src/phone-assets';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { fileInputsFor, LABEL_KEYS } from '../../phone/logic.mjs';

const phone = (path: string) => new URL(`../../phone/${path}`, import.meta.url);
const read = (path: string) => readFileSync(phone(path), 'utf8');
const HTML = read('index.html');
const SCRIPTS = readdirSync(phone('')).filter((name) => /\.(?:mjs|js)$/.test(name));
const CODE = SCRIPTS.map((name) => read(name)).join('\n');
const META = JSON.parse(readFileSync(new URL('../../../../design/tokens/theme-meta.json', import.meta.url), 'utf8')) as {
  canvas: { light: string; dark: string };
};
const SERVED = new Set(PHONE_PAGE_FILES.map(([name]) => name));
const template = (id: string) => HTML.slice(HTML.indexOf(`<template id="${id}">`), HTML.indexOf('</template>', HTML.indexOf(`<template id="${id}">`)));
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

describe('the phone page markup', () => {
  it('has every element the scripts look up by id', () => {
    const ids = new Set([...CODE.matchAll(/(?:byId|getElementById)\(\s*['`]([\w-]+)['`]\s*\)/g)].map((m) => m[1]));
    for (const platform of ['ios', 'android', 'other']) {
      for (const spec of fileInputsFor(platform) as { kind: string }[]) ids.add(`pick-${spec.kind}`);
    }
    expect(ids.size).toBeGreaterThan(30);
    for (const id of ids) expect(HTML, id).toContain(`id="${id}"`);
  });

  it('serves every script the page and its modules import, and every file the page links', () => {
    for (const name of SCRIPTS) {
      expect(SERVED, name).toContain(name);
      for (const match of read(name).matchAll(/from '\.\/([\w.-]+)'/g)) expect(SERVED, `${name} → ${match[1]}`).toContain(match[1]);
    }
    for (const match of HTML.matchAll(/(?:src|href)="\/assets\/([\w.-]+)"/g)) {
      if (match[1] !== 'tus.min.js') expect(SERVED, match[1]).toContain(match[1]);
    }
  });

  it('translates every static string through a catalog key, the steps rail included', () => {
    const keys = [...HTML.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThanOrEqual(40);
    for (const key of keys) expect(LABEL_KEYS, key).toContain(key);
  });

  it('draws the PIN as six separate boxes, one labelled group, each a numeric one-time-code input', () => {
    const group = HTML.slice(HTML.indexOf('<div class="otp"'), HTML.indexOf('</div>', HTML.indexOf('<div class="otp"')));
    expect(group).toMatch(/role="group" aria-labelledby="pin-label" aria-describedby="pin-hint"/);
    const boxes = group.match(/<input[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(6);
    boxes.forEach((box, index) => {
      for (const attribute of ['inputmode="numeric"', 'autocomplete="one-time-code"', `aria-label="Digit ${index + 1} of 6"`]) {
        expect(box, attribute).toContain(attribute);
      }
      // A paste or the keyboard's code suggestion lands in one box whole; maxlength would cut it to one digit.
      expect(box).not.toContain('maxlength');
    });
    expect(HTML).toContain('<p class="label" id="pin-label" data-i18n="pin.label">PIN</p>');
  });

  it('keeps the row templates the scripts fill', () => {
    const row = template('row-template');
    for (const name of ['status-icon', 'row-name', 'row-state', 'row-size', 'row-meter', 'row-reason', 'row-retry', 'row-actions']) {
      expect(count(row, new RegExp(`class="[^"]*\\b${name}\\b`, 'g')), name).toBe(1);
    }
    expect(count(row, /<progress\b/g)).toBe(1);
    expect(template('action-template')).toContain('class="visually-hidden"');
  });

  it('has a screen for every step and every condition, each with its own h1', () => {
    for (const step of ['pair', 'choose', 'sending', 'done']) expect(HTML).toContain(`data-screen="${step}"`);
    for (const condition of ['lost', 'waiting']) expect(HTML).toContain(`data-condition="${condition}"`);
    expect(count(HTML, /<h1\b/g)).toBe(6);
    expect(count(HTML, /<section class="screen[^"]*"[^>]*hidden>/g)).toBe(6);
  });

  it('stays inside the CSP: no inline script, style or handler, and no script writes a style attribute', () => {
    expect(HTML).not.toMatch(/\sstyle=|<style\b|\son[a-z]+=/i);
    for (const script of HTML.match(/<script\b[^>]*>/g) ?? []) expect(script).toMatch(/\ssrc="\/assets\//);
    expect(CODE).not.toMatch(/setAttribute\(\s*'style'|\.innerHTML|\.style\.cssText|\.style\s*=|eval\(|new Function/);
  });

  it('draws every icon it uses from the sprite', () => {
    const symbols = new Set([...HTML.matchAll(/<symbol\s+id="([\w-]+)"/g)].map((match) => match[1]));
    const used = [...HTML.matchAll(/<use href="#([\w-]+)"/g), ...CODE.matchAll(/'(i-[\w-]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(15);
    for (const id of used) expect(symbols, id).toContain(id);
  });

  it("paints the browser's chrome with the canvas of each theme, and carries the four-colour lockup", () => {
    expect(HTML).toContain(`media="(prefers-color-scheme: light)" content="${META.canvas.light}"`);
    expect(HTML).toContain(`media="(prefers-color-scheme: dark)" content="${META.canvas.dark}"`);
    expect(HTML).toMatch(/<svg class="lockup"[^>]*role="img" aria-label="Taalcut">/);
    for (const part of ['arc-1', 'arc-2', 'arc-3', 'arc-4', 'wordmark']) expect(HTML).toContain(`class="${part === 'wordmark' ? part : `arc ${part}`}"`);
  });

  it('keeps every page file within the 400-line limit', () => {
    const files = ['index.html', ...SCRIPTS, ...['app.css', 'controls.css', 'rows.css'].map((name) => `styles/${name}`)];
    for (const name of files) expect(read(name).split('\n').length, name).toBeLessThanOrEqual(401);
  });
});
