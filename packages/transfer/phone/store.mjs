// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// What survives a reload of this tab, in sessionStorage (never localStorage: a new tab pairs again, and nothing
// outlives the tab). Storage can be blocked (private browsing, strict settings); every read then comes back
// empty and every write reports false, and the page works on without it.

export const KEYS = Object.freeze({
  session: 'taalcut.transfer',
  token: 'taalcut.transfer.token',
  queue: 'taalcut.transfer.queue',
  intro: 'taalcut.transfer.intro',
});

/** The storage object, or null when the browser refuses it. */
function storage(host) {
  try {
    return host.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readText(host, key) {
  const store = storage(host);
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Writes `value` (or removes the key for null). Returns whether the browser kept it. */
export function writeText(host, key, value) {
  const store = storage(host);
  if (!store) return false;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson(host, key) {
  const text = readText(host, key);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeJson(host, key, value) {
  return writeText(host, key, value === null ? null : JSON.stringify(value));
}

/** The pairing token from the QR, kept until this tab pairs so a reload still needs only the PIN. */
export function parseToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value) ? value : null;
}
