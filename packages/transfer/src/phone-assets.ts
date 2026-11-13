// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PhoneAsset, PhoneAssets } from './deps';

const SCRIPT = 'text/javascript; charset=utf-8';
const STYLE = 'text/css; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const WOFF2 = 'font/woff2';
const utf8 = new TextDecoder();

/**
 * Every file the phone page serves: the name it has under /assets/ (flat, so a module's relative imports
 * resolve the same on disk and in the browser), where it sits in the phone directory, and its type.
 * index.html is served at `/`. Nothing outside this list is ever read or served.
 */
export const PHONE_PAGE_FILES: ReadonlyArray<readonly [name: string, path: string, type: string]> = [
  ['index.html', 'index.html', 'text/html; charset=utf-8'],
  ['tokens.css', 'styles/tokens.css', STYLE],
  ['base.css', 'styles/base.css', STYLE],
  ['app.css', 'styles/app.css', STYLE],
  ['controls.css', 'styles/controls.css', STYLE],
  ['rows.css', 'styles/rows.css', STYLE],
  ['app.js', 'app.js', SCRIPT],
  ['logic.mjs', 'logic.mjs', SCRIPT],
  ['i18n.mjs', 'i18n.mjs', SCRIPT],
  ['router.mjs', 'router.mjs', SCRIPT],
  ['otp.mjs', 'otp.mjs', SCRIPT],
  ['pairing.mjs', 'pairing.mjs', SCRIPT],
  ['approval.mjs', 'approval.mjs', SCRIPT],
  ['sender.mjs', 'sender.mjs', SCRIPT],
  ['queue.mjs', 'queue.mjs', SCRIPT],
  ['transfer.mjs', 'transfer.mjs', SCRIPT],
  ['connection.mjs', 'connection.mjs', SCRIPT],
  ['store.mjs', 'store.mjs', SCRIPT],
  ['rows.mjs', 'rows.mjs', SCRIPT],
  ['screens.mjs', 'screens.mjs', SCRIPT],
  ['onest-latin.woff2', 'fonts/onest-latin-wght-normal.woff2', WOFF2],
  ['onest-latin-ext.woff2', 'fonts/onest-latin-ext-wght-normal.woff2', WOFF2],
  ['jetbrains-mono-latin.woff2', 'fonts/jetbrains-mono-latin-wght-normal.woff2', WOFF2],
  ['noto-sans-devanagari.woff2', 'fonts/noto-sans-devanagari-devanagari-wght-normal.woff2', WOFF2],
  ['icon.png', 'icon.png', 'image/png'],
];

export const PHONE_LOCALES = ['en', 'hi', 'es', 'pt-BR', 'en-XA'] as const;

/**
 * What the page calls the machine it sends to (UX3-MAC): a Mac ("your Mac") or any other computer ("your
 * computer"). The catalogues name the Mac; `locales/computer/<locale>.json` has each sentence that changes
 * elsewhere, served over them, and index.html's own words (shown until a catalogue loads) follow its English.
 */
export type PhoneMachine = 'mac' | 'computer';

/** Synchronous: the lan process builds its root before it listens. A missing directory yields nothing. */
export function phoneAssetsFromDir(dir: string, machine: PhoneMachine = 'mac'): PhoneAssets {
  const assets: Record<string, PhoneAsset> = {};
  for (const [name, path, type] of PHONE_PAGE_FILES) readInto(assets, join(dir, path), name, type);
  for (const locale of PHONE_LOCALES) {
    const name = `${locale}.json`;
    readInto(assets, join(dir, 'locales', name), name, JSON_TYPE);
  }
  if (machine === 'computer') sayComputer(assets, dir);
  const tus = tusClientPath(dir);
  if (tus) readInto(assets, tus, 'tus.min.js', SCRIPT);
  return assets;
}

/** The catalogues with a computer's words over the Mac's, and index.html's words in English to match. */
function sayComputer(assets: Record<string, PhoneAsset>, dir: string): void {
  for (const locale of PHONE_LOCALES) {
    const name = `${locale}.json`;
    const base = assets[name];
    const words = readWords(join(dir, 'locales', 'computer', name));
    if (!base || !words) continue;
    const merged = { ...(JSON.parse(utf8.decode(base.bytes)) as Record<string, string>), ...words };
    assets[name] = { bytes: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`), type: JSON_TYPE };
  }
  const page = assets['index.html'];
  const english = readWords(join(dir, 'locales', 'computer', 'en.json'));
  if (page && english) {
    assets['index.html'] = { ...page, bytes: Buffer.from(withPageWords(utf8.decode(page.bytes), english)) };
  }
}

function readWords(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

/** index.html with `words` in each element whose `data-i18n` key has them (the elements hold text alone). */
export function withPageWords(html: string, words: Readonly<Record<string, string>>): string {
  return html.replace(/(data-i18n="([\w.-]+)"[^>]*>)([^<]*)</g, (whole, open: string, key: string) => {
    const text = words[key];
    return text === undefined ? whole : `${open}${escapeHtml(text)}<`;
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readInto(assets: Record<string, PhoneAsset>, path: string, name: string, type: string): void {
  if (!existsSync(path)) return;
  assets[name] = { bytes: readFileSync(path), type };
}

function tusClientPath(phoneDir: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(phoneDir, 'tus.min.js'),
    // Source: packages/transfer/src. Compiled: the lan bundle sits in out/utility.
    join(here, '../node_modules/tus-js-client/dist/tus.min.js'),
    join(here, '../../../../packages/transfer/node_modules/tus-js-client/dist/tus.min.js'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}
