// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared string rewrites for crash events and main-produced bundle text.
 * The debug-bundle scan does not import this module: it looks for the raw
 * shapes itself, so a bug here cannot hide a leak from the scan.
 */
import { REDACTED } from '@taalcut/models';

/** Raw value plus base64, base64url and URL-encoded forms. Empty when too short to be a key. */
export function secretForms(secret: string): string[] {
  if (secret.length < 8) return [];
  const b64 = Buffer.from(secret, 'utf8').toString('base64');
  const b64url = b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const forms = new Set<string>([secret, b64, b64.replace(/=+$/, ''), b64url, encodeURIComponent(secret)]);
  return [...forms].filter((form) => form.length >= 8).sort((a, b) => b.length - a.length);
}

/** Longest form first, split/join, so one secret cannot be cut up by another. */
export function applyKnownSecrets(text: string, secrets: readonly string[]): { text: string; count: number } {
  const forms = secrets.flatMap(secretForms).sort((a, b) => b.length - a.length);
  let count = 0;
  let out = text;
  for (const form of forms) {
    if (!out.includes(form)) continue;
    const parts = out.split(form);
    count += parts.length - 1;
    out = parts.join(REDACTED);
  }
  return { text: out, count };
}

/**
 * An external agent's MCP bearer (`tcm_` + 43 base64url characters, core's MCP_TOKEN_PATTERN), also cut short.
 * Main mints them; none is in the vault index the known-secret pass reads, so the shape itself is replaced.
 */
const MCP_TOKEN = /\btcm_[A-Za-z0-9_-]{24,}/g;

export function replaceMcpTokens(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(MCP_TOKEN, () => {
    count += 1;
    return REDACTED;
  });
  return { text: out, count };
}

/** Replaces `homeDir` with `~` only on a path boundary (`file:///Users/x/a` becomes `file://~/a`). */
export function replaceHome(text: string, homeDir: string): { text: string; count: number } {
  const home = homeDir.replace(/[\\/]+$/, '');
  if (home.length < 2 || home === '/') return { text, count: 0 };
  let count = 0;
  let out = '';
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(home, from);
    if (at < 0) {
      out += text.slice(from);
      break;
    }
    const after = at + home.length;
    if (boundaryBefore(text, at) && boundaryAfter(text, after)) {
      out += text.slice(from, at) + '~';
      count += 1;
      from = after;
    } else {
      out += text.slice(from, after);
      from = after;
    }
  }
  return { text: out, count };
}

/** What a user or machine name becomes in a crash event. */
export const NAME_MARK = '<name>';

/**
 * Each name (the account's user name, the Mac's host names) becomes `<name>` wherever it stands on its own,
 * ignoring case; inside a longer word it stays. Names shorter than 3 characters are skipped: they would
 * eat ordinary words.
 */
export function replaceNames(text: string, names: readonly string[]): { text: string; count: number } {
  let count = 0;
  let out = text;
  const usable = names.filter((name) => name.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of usable) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9_-])`, 'gi');
    out = out.replace(pattern, () => {
      count += 1;
      return NAME_MARK;
    });
  }
  return { text: out, count };
}

/** Absolute or home-relative paths become `<path>` or `<path:.ext>`. */
export function replacePaths(text: string): { text: string; count: number } {
  const pattern = /(?:~\/|\/|[A-Za-z]:[\\/])[^\s"'`)<>|]*/g;
  let count = 0;
  const out = text.replace(pattern, (match) => {
    if (!/[\\/]/.test(match.slice(1))) return match;
    count += 1;
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(match);
    return ext ? `<path:.${ext[1]}>` : '<path>';
  });
  return { text: out, count };
}

function boundaryBefore(text: string, at: number): boolean {
  if (at === 0) return true;
  // A file URL (`file:///Users/…`, a stack frame's) holds the home folder after its third slash.
  if (text.slice(Math.max(0, at - 7), at) === 'file://') return true;
  return ' \t\n\r"\'(=:'.includes(text.charAt(at - 1));
}

function boundaryAfter(text: string, at: number): boolean {
  if (at >= text.length) return true;
  return ' \t\n\r"\')\\/,;'.includes(text.charAt(at)) || text.charAt(at) === '/';
}
