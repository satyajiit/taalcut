// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Refuses a debug bundle that still contains a secret, a credential shape,
 * media bytes, a home path, or a media type we do not send. This module
 * copies the secret shapes; it does not import a redactor, so a redaction
 * bug cannot hide a hit. A hit names the section and the rule, never the value.
 */
import { DEBUG_SECTIONS, err, ok, type Result } from '@taalcut/core';
import { DebugBundleUnsafe } from './errors';

const MEDIA_TYPES = new Set(['application/json', 'application/x-ndjson', 'text/plain']);
const SECTIONS = new Set<string>(DEBUG_SECTIONS);
const FTYP_BRANDS = new Set([
  'heic',
  'heix',
  'heif',
  'mif1',
  'msf1',
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'qt  ',
  'avc1',
  'M4V ',
  'M4A ',
]);

const API_KEY = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/,
  /\b(xai|gsk|csk|nvapi|hf)[-_][A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  // An external agent's MCP bearer (core's MCP_TOKEN_PATTERN), also bare or cut short.
  /\btcm_[A-Za-z0-9_-]{24,}/,
];
const DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,]/i;
const B64_RUN = /[A-Za-z0-9+/]{1024,}={0,2}/;
const MEDIA_EXT = '(?:jpe?g|png|gif|webp|heic|mp4|mov|mkv|webm|wav|mp3|flac)';
const MEDIA_PATH = new RegExp(
  `(?:^|[\\s"'\`(])(?:\\/|~\\/|[A-Za-z]:[\\\\/])[^\\s"'\`<>]*\\.${MEDIA_EXT}(?=$|[\\s"'\`)<>])`,
  'i',
);
const MEDIA_FILE = new RegExp(`(?:^|\\/)[^/\\\\\\s]+\\.${MEDIA_EXT}$`, 'i');

export interface ScannableSection {
  readonly section: string;
  readonly path: string;
  readonly mediaType: string;
  readonly text: string;
}

export interface ScanOptions {
  readonly secrets: readonly string[];
  readonly homeDir: string;
}

/** ok when every section is safe to write or send. Does not write or send. */
export function scanBundle(sections: readonly ScannableSection[], options: ScanOptions): Result<void> {
  for (const section of sections) {
    const rule = ruleFor(section, options);
    if (!rule) continue;
    return err(DebugBundleUnsafe({ section: sectionLabel(section.section), rule }));
  }
  return ok(undefined);
}

function ruleFor(section: ScannableSection, options: ScanOptions): string | undefined {
  if (!MEDIA_TYPES.has(section.mediaType)) return 'media_type';
  if (MEDIA_FILE.test(section.path)) return 'media_path';
  const text = `${section.path}\n${section.text}`;
  const bytes = Buffer.from(section.text, 'latin1');
  if (hasMagic(bytes)) return 'media_magic';
  if (DATA_URL.test(text)) return 'data_url';
  if (hasKnownSecret(text, options.secrets)) return 'known_secret';
  if (API_KEY.some((pattern) => pattern.test(text))) return 'api_key';
  if (B64_RUN.test(text)) return 'base64';
  if (hasHomePath(text, options.homeDir)) return 'home_path';
  if (MEDIA_PATH.test(text)) return 'media_path';
  return undefined;
}

function sectionLabel(section: string): string {
  return SECTIONS.has(section) ? section : 'section';
}

function hasKnownSecret(text: string, secrets: readonly string[]): boolean {
  for (const secret of secrets) {
    for (const form of formsOf(secret)) if (text.includes(form)) return true;
  }
  return false;
}

function formsOf(secret: string): string[] {
  if (secret.length < 8) return [];
  const b64 = Buffer.from(secret, 'utf8').toString('base64');
  const b64url = b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return [...new Set([secret, b64, b64.replace(/=+$/, ''), b64url, encodeURIComponent(secret)])].filter(
    (form) => form.length >= 8,
  );
}

function hasHomePath(text: string, homeDir: string): boolean {
  if (text.includes('~/') || text.includes('/Volumes/')) return true;
  const home = homeDir.replace(/[\\/]+$/, '');
  return home.length > 1 && text.includes(home);
}

function hasMagic(buf: Buffer): boolean {
  if (buf.includes(Buffer.from([0xff, 0xd8, 0xff]))) return true;
  if (buf.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buf.includes(Buffer.from('GIF8'))) return true;
  if (buf.includes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return true;
  if (buf.includes(Buffer.from('fLaC'))) return true;
  if (riffKind(buf)) return true;
  if (ftypBrand(buf)) return true;
  if (buf.length >= 4 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return buf[3] === 2 || buf[3] === 3 || buf[3] === 4;
  }
  return buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0;
}

function riffKind(buf: Buffer): boolean {
  let from = 0;
  while (from < buf.length) {
    const at = buf.indexOf('RIFF', from);
    if (at < 0) return false;
    const kind = buf.subarray(at + 8, at + 12).toString('latin1');
    if (kind === 'WEBP' || kind === 'WAVE') return true;
    from = at + 4;
  }
  return false;
}

function ftypBrand(buf: Buffer): boolean {
  let from = 0;
  while (from < buf.length) {
    const at = buf.indexOf('ftyp', from);
    if (at < 0) return false;
    if (FTYP_BRANDS.has(buf.subarray(at + 4, at + 8).toString('latin1'))) return true;
    from = at + 4;
  }
  return false;
}
