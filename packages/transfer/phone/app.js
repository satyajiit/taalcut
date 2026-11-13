// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone page: pair (allowed on the computer, or with the PIN), choose videos, watch them land, see what
// arrived. This file holds the state, the routing between steps (router.mjs decides where you may be) and the
// connection to the Mac; pairing.mjs runs the connect step, sender.mjs the uploads, rows.mjs and screens.mjs
// paint. Every request's failure comes back as a value (call()), so each one gets its own screen or sentence.
import { initialConnection, nextCheckMs, noteConnection, outcomeOf } from './connection.mjs';
import { loadCatalog, translate } from './i18n.mjs';
import { detectPlatform, deviceLabel, failureInfo, fileInputsFor, readStoredSession } from './logic.mjs';
import { labelKey, requestJson } from './logic.mjs';
import { createPairing } from './pairing.mjs';
import { adoptRemote, applyRemote, restoreItems, snapshotOf, summarize } from './queue.mjs';
import { hashFor, parseHash, resolveRoute } from './router.mjs';
import { syncList } from './rows.mjs';
import { paintBeats, paintChoose, paintDone, paintSummary, setBusy, showScreen } from './screens.mjs';
import { followTopbar, titleFor, translatePage } from './screens.mjs';
import { createSender } from './sender.mjs';
import { KEYS, parseToken, readJson, readText, writeJson, writeText } from './store.mjs';

const doc = globalThis.document;
const loc = globalThis.location;
const nav = globalThis.navigator;
const byId = (id) => doc.getElementById(id);
const platform = detectPlatform(nav.userAgent);
const state = {
  catalog: {},
  locale: 'en',
  token: null,
  credential: '',
  deviceId: '',
  items: [],
  nextId: 1,
  route: '',
  expired: false,
  booted: false,
  connection: initialConnection(),
  checkTimer: 0,
};
const lists = { send: new Map(), arrived: new Map(), missing: new Map() };
const t = (key, values) => translate(state.catalog, key, values);
const visible = () => doc.visibilityState === 'visible';
const rowContext = () => ({ doc, t, locale: state.locale, onAction: (item, action) => sender.act(item, action) });
const sender = createSender({
  state,
  origin: loc.origin,
  tus: () => globalThis.tus,
  api: (path, options) => requestJson(fetchFor, path, withCredential(options)),
  isVisible: visible,
  listen: (onChange) => {
    doc.addEventListener('visibilitychange', onChange);
    return () => doc.removeEventListener('visibilitychange', onChange);
  },
  changed,
  progressed,
  expired: expire,
});
let pairing = null;

void start();

async function start() {
  const first = parseHash(loc.hash);
  if (first.token) writeText(globalThis, KEYS.token, first.token);
  state.token = first.token ?? parseToken(readText(globalThis, KEYS.token));
  const saved = readStoredSession(readText(globalThis, KEYS.session));
  if (saved) {
    state.credential = saved.credential;
    state.deviceId = saved.deviceId;
  }
  state.items = restoreItems(readJson(globalThis, KEYS.queue), 1);
  state.nextId = state.items.length + 1;
  state.catalog = await loadCatalog(nav.languages, fetchJson);
  state.locale = typeof state.catalog.locale === 'string' ? state.catalog.locale : 'en';
  doc.documentElement.lang = state.locale === 'en-XA' ? 'en' : state.locale;
  translatePage(doc, t);
  pairing = createPairing({
    doc,
    t,
    call,
    token: () => state.token,
    forgetToken,
    expired: () => state.expired,
    visible,
    deviceName: deviceLabel(nav.userAgent),
    onPaired: connected,
  });
  configurePickers();
  wire();
  followTopbar(doc);
  if (!readText(globalThis, KEYS.intro)) {
    byId('lockup').setAttribute('data-intro', '');
    writeText(globalThis, KEYS.intro, '1');
  }
  render();
  state.booted = true;
  if (state.route === 'pair') pairing.enter({ focus: true });
  if (state.credential) scheduleCheck(0);
}

function wire() {
  byId('lost-retry').addEventListener('click', () => void checkNow());
  byId('waiting-check').addEventListener('click', () => void checkNow());
  doc.addEventListener('click', (event) => {
    const link = event.target instanceof globalThis.Element ? event.target.closest('a[href^="#/"]') : null;
    const route = link ? parseHash(link.getAttribute('href')).route : null;
    if (!route) return;
    event.preventDefault();
    go(route);
  });
  globalThis.addEventListener('popstate', () => render({ arrive: true }));
  globalThis.addEventListener('hashchange', () => render({ arrive: true }));
  doc.addEventListener('visibilitychange', () => {
    if (visible() && state.credential) scheduleCheck(0);
  });
}

function configurePickers() {
  for (const spec of fileInputsFor(platform)) {
    const input = byId(`pick-${spec.kind}`);
    input.accept = spec.accept;
    input.multiple = true;
    input.removeAttribute('capture');
    input.addEventListener('change', () => {
      const picked = Array.from(input.files ?? []);
      input.value = '';
      if (sender.enqueue(picked)) go('sending');
    });
  }
}

// Routing ---------------------------------------------------------------------------------------------------

function facts() {
  const totals = summarize(state.items);
  return { paired: Boolean(state.credential), rows: totals.total, active: totals.active > 0 };
}

/** Goes to a step. Going back to the step this one was opened from steps back, so history never piles up. */
function go(route, { replace = false } = {}) {
  const history = globalThis.history;
  if (!replace && history.state?.from === route && parseHash(loc.hash).route !== route) {
    history.back();
    return;
  }
  if (replace) history.replaceState(history.state, '', hashFor(route));
  else if (parseHash(loc.hash).route !== route) history.pushState({ from: state.route }, '', hashFor(route));
  render({ arrive: true });
}

/** While paired and the Mac can't be reached, a condition screen stands in for the step. */
function conditionFor() {
  if (!state.credential || state.connection.status === 'online') return null;
  return state.connection.status;
}

function render({ arrive = false } = {}) {
  const requested = parseHash(loc.hash).route;
  const route = resolveRoute(requested, facts());
  if (route !== requested) globalThis.history.replaceState(globalThis.history.state, '', hashFor(route));
  const moved = route !== state.route;
  state.route = route;
  const animate = arrive && state.booted;
  paintBeats(doc, route, animate && moved);
  paintStep(route, animate && !moved);
  const surface = conditionFor() ?? route;
  const changedScreen = showScreen(doc, surface, { arrive: animate, focus: animate && surface !== 'pair' });
  doc.title = titleFor(surface, t);
  if (changedScreen && animate && surface === 'pair') pairing.enter({ focus: true });
}

function paintStep(route, rowsArrive) {
  const totals = summarize(state.items);
  const ctx = rowContext();
  if (route === 'pair') pairing.paint();
  if (route === 'choose') {
    const kinds = new Set(fileInputsFor(platform).map((spec) => spec.kind));
    paintChoose(doc, t, { platform, kinds, totals });
  }
  if (route === 'sending') {
    syncList(byId('send-list'), state.items, lists.send, ctx, { arrive: rowsArrive });
    paintSummary(doc, t, state.locale, totals, overallFraction());
  }
  if (route === 'done') {
    const arrived = state.items.filter((item) => item.state === 'imported' || item.state === 'duplicate');
    const missing = state.items.filter((item) => !arrived.includes(item));
    syncList(byId('done-arrived'), arrived, lists.arrived, ctx, { withActions: false, arrive: false });
    syncList(byId('done-missing'), missing, lists.missing, ctx, { arrive: false });
    paintDone(doc, t, totals);
  }
}

function overallFraction() {
  const total = state.items.reduce((sum, item) => sum + (item.record.size || 0), 0);
  return total ? (total - summarize(state.items).bytesLeft) / total : 0;
}

/** A row's state moved: keep it for a reload, and repaint (which also moves on to done when all settle). */
function changed() {
  writeJson(globalThis, KEYS.queue, state.items.length ? snapshotOf(state.items) : null);
  render({ arrive: true });
}

/** Bytes moved: repaint the sending list in place (no arrivals, no step change). */
function progressed() {
  if (state.route !== 'sending' || conditionFor()) return;
  syncList(byId('send-list'), state.items, lists.send, rowContext(), { arrive: false });
  paintSummary(doc, t, state.locale, summarize(state.items), overallFraction());
}

// Pairing and the connection --------------------------------------------------------------------------------

function connected({ credential, deviceId }) {
  state.credential = credential;
  state.deviceId = deviceId;
  state.expired = false;
  state.connection = initialConnection();
  writeText(globalThis, KEYS.session, JSON.stringify({ deviceId, credential }));
  writeText(globalThis, KEYS.token, null);
  go(summarize(state.items).active > 0 ? 'sending' : 'choose', { replace: true });
  scheduleCheck(0);
  void sender.pump();
}

/** The QR's token was refused (a new QR replaced it): the setup code stands in for it. */
function forgetToken() {
  state.token = null;
  writeText(globalThis, KEYS.token, null);
}

/** The Mac no longer knows this phone (its connection ran out, or it was forgotten): pair again, then carry on. */
function expire() {
  state.credential = '';
  state.deviceId = '';
  state.expired = true;
  state.connection = initialConnection();
  writeText(globalThis, KEYS.session, null);
  sender.suspend();
  changed();
}

function scheduleCheck(delay) {
  globalThis.clearTimeout(state.checkTimer);
  state.checkTimer = globalThis.setTimeout(() => void check(), delay);
}

/** Asks the Mac how this phone's files are doing; the answer (or its absence) is the connection's state. */
async function check() {
  if (!state.credential || !visible()) return;
  const result = await call('/api/session');
  if (!state.credential) return;
  if (!result.ok && outcomeOf(result.status) === 'expired') {
    expire();
    return;
  }
  noteOutcome(result.ok ? 'ok' : outcomeOf(result.status));
  if (result.ok) applySession(result.value);
  scheduleCheck(nextCheckMs(state.connection));
}

async function checkNow() {
  const button = byId('lost-retry');
  const label = byId('lost-retry-label');
  setBusy(button, label, true, t(labelKey.lostTrying));
  globalThis.clearTimeout(state.checkTimer);
  await check();
  setBusy(button, label, false, t(labelKey.lostRetry));
}

function noteOutcome(outcome) {
  const before = state.connection.status;
  state.connection = noteConnection(state.connection, outcome, Date.now());
  if (before === state.connection.status) return;
  render({ arrive: true });
  if (state.connection.status === 'online') void sender.pump();
}

function applySession(session) {
  const { changed: moved, halt, adopt } = applyRemote(state.items, session?.files);
  for (const item of halt) sender.halt(item);
  for (const remote of adopt) {
    state.items.push(adoptRemote(state.nextId, remote));
    state.nextId += 1;
  }
  if (moved.size || halt.length || adopt.length) changed();
}

// Requests --------------------------------------------------------------------------------------------------

function fetchFor(url, init) {
  return globalThis.fetch(url, init);
}

function withCredential(options = {}) {
  return { ...options, credential: state.credential };
}

/** A request whose failure is a value: { ok: true, value } or { ok: false, status, retryAfter }. */
async function call(path, options) {
  try {
    return { ok: true, value: await requestJson(fetchFor, path, withCredential(options)) };
  } catch (error) {
    const info = failureInfo(error);
    return { ok: false, status: info.status, retryAfter: info.retryAfter };
  }
}

async function fetchJson(url) {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
