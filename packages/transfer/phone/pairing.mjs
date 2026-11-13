// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The connect step. A page opened from the QR asks the computer to let this phone in and waits for a person to
// allow it (approval.mjs runs the asking; this paints it). "Use the PIN instead", a page opened without the QR and
// a QR that changed use the form: the setup code (only without the QR), the PIN boxes and Connect. Every way
// pairing can fail has its own sentence in the place the hint was, so nothing on the screen jumps.
import { createApprovalRun } from './approval.mjs';
import { labelKey, pairBody } from './logic.mjs';
import { mountOtp } from './otp.mjs';
import { paintApproval, paintPair, setBusy } from './screens.mjs';

/** How long the boxes show success before the page moves on. */
export const CONNECTED_MS = 480;
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * The setup code as the Mac checks it. The Mac shows it in two groups of four ("7KD2 M9QX"), so spaces and dashes
 * go, case doesn't matter, and the letters Crockford's base32 leaves out are read as the digits they look like
 * (O as 0, I and L as 1).
 */
export function setupCodeOf(text) {
  return String(text ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** The sentence for a pairing request that failed with `status` (0: no answer at all). */
export function pairErrorKey(status) {
  if (status === 401) return labelKey.pairErrorRejected;
  if (status === 429) return labelKey.pairErrorRate;
  if (status === 403) return labelKey.pairErrorFull;
  if (status === 404) return labelKey.pairErrorClosed;
  return labelKey.pairErrorNetwork;
}

/**
 * `host`: { doc, t, call(path, options), token() (the QR's token or null), forgetToken(), expired() (a
 * connection ran out), visible(), deviceName, onPaired(result) }. Returns the step's controls.
 */
export function createPairing(host) {
  const { doc, t } = host;
  const win = doc.defaultView ?? globalThis;
  const byId = (id) => doc.getElementById(id);
  const submitButton = byId('pair-submit');
  const submitLabel = byId('pair-submit-label');
  const errorBox = byId('pair-error');
  let busy = false;
  // 'approve' (from the QR: the computer allows this phone) or 'pin' (the form).
  let mode = host.token() ? 'approve' : 'pin';
  const otp = mountOtp(byId('pin'), { onChange: clearError, onComplete: () => void submit() });
  const run = createApprovalRun({
    call: host.call,
    token: host.token,
    deviceName: host.deviceName,
    visible: host.visible,
    setTimer: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimer: (id) => globalThis.clearTimeout(id),
    onChange: approvalChanged,
  });

  byId('pair-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  byId('code').addEventListener('input', clearError);
  byId('approval-again').addEventListener('click', () => void run.ask());
  byId('approval-pin').addEventListener('click', usePin);
  // Polling stops while the page is hidden; seen again, it asks at once. A page that goes away withdraws its
  // request (best effort); one the browser brings back hears that it lapsed and offers Ask again.
  doc.addEventListener('visibilitychange', () => {
    if (host.visible()) run.resume();
  });
  win.addEventListener('pagehide', () => run.withdraw());
  win.addEventListener('pageshow', (event) => {
    if (event.persisted) run.resume();
  });

  function paint() {
    const approving = mode === 'approve';
    paintPair(doc, t, { hasToken: Boolean(host.token()), expired: host.expired(), approving });
    paintApproval(doc, t, run.view());
  }

  /** The connect step is showing: from the QR, ask the computer at once; otherwise wait for the form. */
  function enter({ focus = false } = {}) {
    if (!host.token()) mode = 'pin';
    paint();
    if (mode === 'pin') {
      if (focus) focusField();
      return;
    }
    if (focus) byId('pair-title').focus({ preventScroll: true });
    if (run.view().phase === 'idle') void run.ask();
  }

  function approvalChanged(view) {
    if (mode !== 'approve') return;
    if (view.phase === 'failed' && view.reason === 'refused') {
      refused();
      return;
    }
    // Ask again goes while the computer is asked; focus it held moves to the heading, not to nowhere.
    const again = byId('approval-again');
    if (doc.activeElement === again && view.phase !== 'failed') {
      byId('pair-title').focus({ preventScroll: true });
    }
    paintApproval(doc, t, view);
    if (view.phase !== 'allowed') return;
    const result = { credential: view.credential, deviceId: view.deviceId };
    globalThis.setTimeout(() => paired(result), CONNECTED_MS);
  }

  /** "Use the PIN instead": the request is withdrawn and the PIN form takes its place. */
  function usePin() {
    if (run.view().phase === 'allowed') return;
    mode = 'pin';
    run.stop();
    paint();
    focusField();
  }

  /** The computer refused the QR's token (a new QR replaced it): the setup code and the PIN it shows instead. */
  function refused() {
    mode = 'pin';
    run.stop();
    host.forgetToken();
    paint();
    showError(labelKey.approvalRefused, '');
    byId('code').focus({ preventScroll: true });
  }

  function paired(result) {
    run.stop();
    // A connection that runs out later asks the computer again while the QR's token is still at hand.
    mode = host.token() ? 'approve' : 'pin';
    host.onPaired(result);
  }

  function focusField() {
    if (host.token()) otp.focusFirstEmpty();
    else byId('code').focus({ preventScroll: true });
  }

  async function submit() {
    if (busy || submitButton.disabled) return;
    const code = setupCodeOf(byId('code').value);
    const pin = otp.value();
    if (!host.token() && !CODE.test(code)) {
      showError(labelKey.pairErrorCode, 'code');
      byId('code').focus({ preventScroll: true });
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      showError(labelKey.pairErrorInvalid, 'pin');
      otp.focusFirstEmpty();
      return;
    }
    busy = true;
    otp.setState('busy');
    setBusy(submitButton, submitLabel, true, t(labelKey.pairWorking));
    const body = pairBody({ token: host.token(), code, pin, name: host.deviceName });
    const result = await host.call('/api/pair', { method: 'POST', body });
    setBusy(submitButton, submitLabel, false, t(labelKey.pairSubmit));
    busy = false;
    const value = result.ok ? result.value : null;
    if (typeof value?.credential !== 'string' || typeof value?.deviceId !== 'string') {
      failed(result.ok ? 401 : result.status, result.retryAfter);
      return;
    }
    otp.setState('success');
    submitButton.dataset.state = 'success';
    submitLabel.textContent = t(labelKey.pairDone);
    globalThis.setTimeout(() => {
      reset();
      paired({ credential: value.credential, deviceId: value.deviceId });
    }, CONNECTED_MS);
  }

  function failed(status, retryAfter) {
    showError(pairErrorKey(status), status === 401 ? 'pin' : '');
    if (status === 401) otp.focusFirst();
    if (status !== 429) return;
    // The Mac allows one try a second per phone; Connect waits as long as it asks.
    submitButton.disabled = true;
    const seconds = Number(retryAfter) > 0 ? Number(retryAfter) : 5;
    globalThis.setTimeout(() => {
      submitButton.disabled = false;
    }, seconds * 1000);
  }

  function showError(key, field) {
    byId('pair-error-text').textContent = t(key);
    errorBox.hidden = false;
    byId('pin-hint').hidden = true;
    byId('pin').setAttribute('aria-describedby', 'pair-error-text');
    byId('code').setAttribute('aria-invalid', String(field === 'code'));
    otp.setState(field === 'pin' ? 'error' : 'idle');
  }

  function clearError() {
    if (errorBox.hidden) return;
    errorBox.hidden = true;
    byId('pin-hint').hidden = false;
    byId('pin').setAttribute('aria-describedby', 'pin-hint');
    byId('code').setAttribute('aria-invalid', 'false');
    otp.setState('idle');
  }

  function reset() {
    delete submitButton.dataset.state;
    submitLabel.textContent = t(labelKey.pairSubmit);
    otp.clear();
    otp.setState('idle');
  }

  return { submit, enter, paint };
}
