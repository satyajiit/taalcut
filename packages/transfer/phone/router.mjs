// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Hash routes, so the Mac serves one page and Back, a reload or a typed address all land on a real step.
// The four steps are the transfer's four beats: connect, choose, send, done.
import { readTokenFromHash } from './logic.mjs';

export const STEPS = Object.freeze(['pair', 'choose', 'sending', 'done']);

const ROUTE = /^#\/([a-z]+)\/?$/;

/** The step a hash names (or null), and the QR's pairing token when the hash carries one (`#k=…`). */
export function parseHash(hash) {
  const text = String(hash ?? '');
  const match = ROUTE.exec(text);
  if (match && STEPS.includes(match[1])) return { route: match[1], token: null };
  return { route: null, token: readTokenFromHash(text) };
}

export function hashFor(route) {
  return `#/${STEPS.includes(route) ? route : 'pair'}`;
}

export function stepIndex(route) {
  return Math.max(0, STEPS.indexOf(route));
}

/**
 * Where the page should be, given where it was asked to go. `facts`: `paired` (a credential is held), `rows`
 * (files this visit knows about) and `active` (any of them still on its way or still being added).
 * Unpaired, every step is the PIN. Paired, the PIN is behind you; sending needs something on its way, done
 * needs something that finished, and an unknown or empty route goes to whichever of those fits.
 */
export function resolveRoute(requested, facts) {
  const paired = Boolean(facts?.paired);
  const rows = Number(facts?.rows) || 0;
  const active = Boolean(facts?.active);
  if (!paired) return 'pair';
  const settledStep = rows > 0 ? 'done' : 'choose';
  const resting = active ? 'sending' : 'choose';
  if (requested === 'choose') return 'choose';
  if (requested === 'sending') return active ? 'sending' : settledStep;
  if (requested === 'done') return rows === 0 ? 'choose' : active ? 'sending' : 'done';
  return resting;
}

/** Each step against the current one: passed steps are 'done', this one 'current', the rest 'todo'. */
export function beatStates(route) {
  const at = stepIndex(route);
  return STEPS.map((step, index) => {
    if (index < at) return [step, 'done'];
    if (index === at) return [step, 'current'];
    return [step, 'todo'];
  });
}
