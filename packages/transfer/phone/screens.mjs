// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Which surface shows, and the words on it. A step's screen or, while the Mac can't be reached, a condition
// screen in its place (the step underneath is kept, so Back and the beat rail still say where you are).
import { formatBytes, labelKey } from './logic.mjs';
import { beatStates } from './router.mjs';
import { markArrival } from './rows.mjs';

const TITLES = {
  pair: labelKey.pairTitle,
  choose: labelKey.chooseTitle,
  sending: labelKey.sendTitle,
  done: labelKey.doneTitle,
  lost: labelKey.lostTitle,
  waiting: labelKey.waitingTitle,
};

/** Fills every `data-i18n` text and `data-i18n-label` name, and names the PIN boxes "Digit n of N". */
export function translatePage(doc, t) {
  for (const node of doc.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
  for (const node of doc.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.getAttribute('data-i18n-label')));
  }
  const digits = Array.from(doc.querySelectorAll('#pin .digit'));
  digits.forEach((digit, index) => {
    digit.setAttribute('aria-label', t(labelKey.pinDigit, { n: index + 1, total: digits.length }));
  });
}

/**
 * Shows `name` (a step or a condition) and hides the rest. `arrive` plays the step's entrance; `focus` moves
 * focus to its heading, so a screen reader hears where it landed. Returns whether anything changed.
 */
export function showScreen(doc, name, { arrive = false, focus = false } = {}) {
  let changed = false;
  for (const screen of doc.querySelectorAll('.screen')) {
    const mine = screen.dataset.screen === name || screen.dataset.condition === name;
    if (screen.hidden === !mine) continue;
    screen.hidden = !mine;
    changed = true;
    if (mine && arrive) markArrival(screen);
  }
  // A new step starts at its top, under the bar, not wherever a long list of the last one was scrolled to.
  if (changed && arrive) doc.defaultView?.scrollTo(0, 0);
  if (changed && focus) doc.querySelector(`.screen:not([hidden]) h1`)?.focus({ preventScroll: true });
  return changed;
}

/**
 * The bar at the top stays put while the step scrolls under it. Its height goes into --bar-block, which the
 * page's scroll-padding reads, so a field brought into view (the PIN while the keyboard is up) lands below it;
 * once anything has scrolled under it, it shows its hairline.
 */
export function followTopbar(doc) {
  const win = doc.defaultView;
  const bar = doc.getElementById('topbar');
  if (!win || !bar) return;
  const root = doc.documentElement;
  const measure = () => root.style.setProperty('--bar-block', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  const scrolled = () => bar.toggleAttribute('data-scrolled', win.scrollY > 0);
  if (typeof win.ResizeObserver === 'function') new win.ResizeObserver(measure).observe(bar);
  else win.addEventListener('resize', measure);
  win.addEventListener('scroll', scrolled, { passive: true });
  measure();
  scrolled();
}

/** The beat rail for `route`; the step that just became current fills once when `arrive` is set. */
export function paintBeats(doc, route, arrive) {
  for (const [step, state] of beatStates(route)) {
    const beat = doc.querySelector(`.beats [data-step="${step}"]`);
    if (!beat || beat.dataset.state === state) continue;
    beat.dataset.state = state;
    if (state === 'current') beat.setAttribute('aria-current', 'step');
    else beat.removeAttribute('aria-current');
    if (state === 'current' && arrive) markArrival(beat);
  }
}

/** "Choose videos · Taalcut": the shown screen's name first, for the tab switcher. */
export function titleFor(name, t) {
  return `${t(TITLES[name] ?? labelKey.pairTitle)} · Taalcut`;
}

/**
 * The pair step: a first visit, a phone without the QR (setup code too), or a connection that ran out; from the
 * QR (`approving`), the computer's approval in place of the form.
 */
export function paintPair(doc, t, { hasToken, expired, approving = false }) {
  doc.getElementById('approval').hidden = !approving;
  doc.getElementById('pair-form').hidden = approving;
  doc.getElementById('pair-help').hidden = approving;
  doc.getElementById('code-field').hidden = hasToken;
  doc.getElementById('code').disabled = hasToken;
  doc.getElementById('pair-title').textContent = t(expired ? labelKey.pairTitleAgain : labelKey.pairTitle);
  let lede = hasToken ? labelKey.pairLede : labelKey.pairLedeCode;
  if (expired) lede = labelKey.pairExpired;
  if (approving) lede = expired ? labelKey.pairExpiredApprove : labelKey.pairLedeApprove;
  doc.getElementById('pair-lede').textContent = t(lede);
}

/**
 * The approval (approval.mjs's view): the match code, dimmed once its request is over, and one line that waits,
 * says what went wrong or connects, with Ask again where asking again can help.
 */
export function paintApproval(doc, t, view) {
  const match = doc.getElementById('approval-match');
  match.hidden = !view.code;
  match.dataset.state = view.phase;
  match.toggleAttribute('data-stale', view.stale);
  const code = doc.getElementById('approval-code');
  if (code.textContent !== view.code) code.textContent = view.code;
  const line = doc.getElementById('approval-line');
  line.dataset.state = view.phase === 'failed' || view.phase === 'allowed' ? view.phase : 'waiting';
  const text = doc.getElementById('approval-text');
  const sentence = t(view.key);
  if (text.textContent !== sentence) text.textContent = sentence;
  const again = doc.getElementById('approval-again');
  again.hidden = !(view.phase === 'failed' && view.again);
  again.disabled = view.held;
  doc.getElementById('approval-pin').disabled = view.phase === 'allowed';
}

/** The choose step: this phone's pickers, and a way back to what is on its way or what arrived. */
export function paintChoose(doc, t, { platform, kinds, totals }) {
  for (const block of doc.querySelectorAll('.pick[data-kind]')) block.hidden = !kinds.has(block.dataset.kind);
  doc.getElementById('guide').hidden = platform !== 'ios';
  doc.getElementById('choose-lede').textContent = t(
    platform === 'ios' ? labelKey.chooseLedeIos : labelKey.chooseLede,
  );
  const strip = doc.getElementById('choose-strip');
  strip.hidden = totals.total === 0;
  if (strip.hidden) return;
  const sending = totals.active > 0;
  doc.getElementById('choose-strip-text').textContent = sending
    ? t(labelKey.chooseSending, { count: totals.active })
    : t(labelKey.chooseFinished, { done: totals.arrived, total: totals.total });
  doc.getElementById('choose-strip-label').textContent = t(
    sending ? labelKey.chooseSeeProgress : labelKey.chooseSeeDone,
  );
  doc.getElementById('choose-strip-link').setAttribute('href', sending ? '#/sending' : '#/done');
}

/** The sending step's summary line ("2 of 5 added · 1.2 GB to go") and its overall bar. */
export function paintSummary(doc, t, locale, totals, fraction) {
  const count = t(labelKey.summaryCount, { done: totals.arrived, total: totals.total });
  const left = totals.bytesLeft > 0 ? t(labelKey.summaryLeft, { size: formatBytes(totals.bytesLeft, locale) }) : '';
  const summary = doc.getElementById('summary');
  const text = left ? `${count} · ${left}` : count;
  if (summary.textContent !== text) summary.textContent = text;
  doc.getElementById('overall').style.setProperty('--progress', String(fraction));
}

/** The done step: everything on the Mac, or how many made it and why the rest didn't. */
export function paintDone(doc, t, totals) {
  const all = totals.notSent === 0;
  doc.getElementById('done-title').textContent = all
    ? t(labelKey.doneTitle)
    : t(labelKey.doneTitleSome, { done: totals.arrived, total: totals.total });
  doc.getElementById('done-lede').textContent = t(all ? labelKey.doneLede : labelKey.doneLedeSome);
  // Kaatu grins only when everything made it; some not sent is no moment to celebrate.
  doc.getElementById('done-kaatu').hidden = !all;
  doc.getElementById('done-arrived-group').hidden = totals.arrived === 0;
  doc.getElementById('done-missing-group').hidden = totals.notSent === 0;
}

/** A button's busy state: spinner, aria-busy, a working label, and no second press. */
export function setBusy(button, label, busy, text) {
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
  label.textContent = text;
}
