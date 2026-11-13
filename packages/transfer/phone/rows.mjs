// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// One file's row, built from #row-template and repainted in place as its state changes. Rows never write a
// style attribute (the page's CSP): the bar's length is a custom property set through the CSSOM.
import { formatBytes, labelKey, stateLabelKey } from './logic.mjs';
import { actionsFor, reasonKeyFor } from './queue.mjs';

const ICONS = {
  waiting: 'i-clock',
  sending: 'i-up',
  paused: 'i-offline',
  held: 'i-held',
  received: 'i-check',
  checking: 'i-check',
  importing: 'i-check',
  imported: 'i-done',
  duplicate: 'i-copy',
  failed: 'i-alert',
  rejected: 'i-refused',
  cancelled: 'i-stopped',
  ghost: 'i-ghost',
};

const ACTIONS = {
  pause: ['i-pause', labelKey.filePause],
  resume: ['i-play', labelKey.fileResume],
  stop: ['i-x', labelKey.fileStop],
  remove: ['i-x', labelKey.fileRemove],
};

const MOVING = new Set(['sending', 'paused', 'held']);

/** A new row for `item`. `ctx`: { doc, t, locale, onAction(item, action) }. */
export function createRow(item, ctx) {
  const row = ctx.doc.getElementById('row-template').content.firstElementChild.cloneNode(true);
  const pick = (selector) => row.querySelector(selector);
  const els = {
    row,
    icon: pick('.status-icon use'),
    name: pick('.row-name'),
    state: pick('.row-state'),
    size: pick('.row-size'),
    bar: pick('.bar'),
    progress: pick('progress'),
    meter: pick('.row-meter'),
    reason: pick('.row-reason'),
    retry: pick('.row-retry'),
    retryLabel: pick('.retry-label'),
    actions: pick('.row-actions'),
    actionsKey: null,
  };
  const nameId = `row-name-${item.id}`;
  els.name.id = nameId;
  els.retry.setAttribute('aria-describedby', nameId);
  els.retry.addEventListener('click', () => ctx.onAction(item, els.retry.dataset.action));
  return els;
}

/** Repaints a row. `withActions` false (the done screen) leaves out every control. */
export function paintRow(els, item, ctx, withActions = true) {
  const { t, locale } = ctx;
  const size = item.record.size || 0;
  const sent = Math.min(item.sent || 0, size);
  const fraction = size ? sent / size : 0;
  els.row.dataset.state = item.state;
  els.row.dataset.verdict = item.verdict;
  els.icon.setAttribute('href', `#${ICONS[item.state] ?? 'i-clock'}`);
  els.name.textContent = item.record.name;
  const cancelledOnMac = item.state === 'cancelled' && item.cancelledBy === 'mac';
  els.state.textContent = t(cancelledOnMac ? labelKey.stateCancelledMac : stateLabelKey(item.state));
  els.size.textContent = formatBytes(size, locale);
  els.bar.style.setProperty('--progress', String(fraction));
  els.progress.max = size || 1;
  els.progress.value = sent;
  els.progress.setAttribute(
    'aria-label',
    t(labelKey.fileProgress, { sent: formatBytes(sent, locale), total: formatBytes(size, locale) }),
  );
  els.meter.textContent = MOVING.has(item.state) ? meterText(item, sent, size, fraction, ctx) : '';
  const reason = reasonKeyFor(item);
  els.reason.textContent = reason ? t(reason) : '';
  const actions = withActions ? actionsFor(item) : [];
  const textAction = actions.find((action) => action === 'retry' || action === 'again');
  els.retry.hidden = !textAction;
  if (textAction) {
    els.retry.dataset.action = textAction;
    // The words go in their own span: the retry glyph before them stays (UX4, icons on every button).
    els.retryLabel.textContent = t(textAction === 'retry' ? labelKey.fileRetry : labelKey.fileAgain);
  }
  paintActions(els, item, ctx, actions.filter((action) => ACTIONS[action]));
}

function meterText(item, sent, size, fraction, { t, locale }) {
  const values = {
    percent: percentFormat(locale).format(fraction),
    sent: formatBytes(sent, locale),
    total: formatBytes(size, locale),
  };
  if (item.state === 'sending' && item.speed > 0) {
    return t(labelKey.fileMeterSpeed, { ...values, speed: formatBytes(item.speed, locale) });
  }
  return t(labelKey.fileMeter, values);
}

/** Icon buttons are rebuilt only when the set changes, and keep focus in the row when they do. */
function paintActions(els, item, ctx, actions) {
  const names = item.record.name;
  const key = `${actions.join(' ')}|${names}`;
  if (els.actionsKey === key) return;
  const hadFocus = els.actions.contains(ctx.doc.activeElement);
  els.actionsKey = key;
  const buttons = actions.map((action) => {
    const [icon, label] = ACTIONS[action];
    const button = ctx.doc.getElementById('action-template').content.firstElementChild.cloneNode(true);
    button.dataset.action = action;
    button.querySelector('use').setAttribute('href', `#${icon}`);
    button.querySelector('.visually-hidden').textContent = ctx.t(label, { name: names });
    button.addEventListener('click', () => ctx.onAction(item, action));
    return button;
  });
  els.actions.replaceChildren(...buttons);
  if (hadFocus) (buttons[0] ?? els.retry).focus({ preventScroll: true });
}

function percentFormat(locale) {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent' });
  } catch {
    return new Intl.NumberFormat('en', { style: 'percent' });
  }
}

/**
 * Keeps `list` showing exactly `items`, in order, reusing each item's row. New rows (when `arrive` is true)
 * rise in once. `cache` maps an item to its row elements, per list.
 */
export function syncList(list, items, cache, ctx, { withActions = true, arrive = true } = {}) {
  const keep = new Set(items);
  for (const [item, els] of cache) {
    if (keep.has(item)) continue;
    els.row.remove();
    cache.delete(item);
  }
  items.forEach((item, index) => {
    let els = cache.get(item);
    if (!els) {
      els = createRow(item, ctx);
      cache.set(item, els);
      if (arrive) markArrival(els.row);
    }
    paintRow(els, item, ctx, withActions);
    if (list.children[index] !== els.row) list.insertBefore(els.row, list.children[index] ?? null);
  });
}

/** Plays the arrival once; the attribute goes when it ends so a later repaint never replays it. */
export function markArrival(node) {
  node.setAttribute('data-arrive', '');
  node.addEventListener('animationend', () => node.removeAttribute('data-arrive'), { once: true });
}
