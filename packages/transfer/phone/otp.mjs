// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The PIN as separate digit boxes, one real input each. The model below is pure (tested on its own); the
// controller wires it to the boxes: typing advances, Backspace on an empty box steps back, a paste or the
// keyboard's one-time-code suggestion fills every box, and the arrows move between boxes.

export const PIN_LENGTH = 6;

export function digitsOnly(text) {
  return String(text ?? '').replace(/\D/g, '');
}

export function emptyDigits(length = PIN_LENGTH) {
  return Array.from({ length }, () => '');
}

/**
 * Digits typed or pasted into box `index`. They fill from that box onwards; a whole code (as many digits as
 * there are boxes) fills from the first box wherever it lands. Returns the new digits and the box to focus.
 */
export function fillAt(digits, index, text) {
  const incoming = digitsOnly(text);
  const next = digits.slice();
  if (!incoming) return { digits: next, focus: index };
  let at = incoming.length >= next.length ? 0 : index;
  for (const digit of incoming) {
    if (at >= next.length) break;
    next[at] = digit;
    at += 1;
  }
  return { digits: next, focus: Math.min(at, next.length - 1) };
}

/** Backspace in box `index`: clears it, or, when it is already empty, clears the box before and goes there. */
export function eraseAt(digits, index) {
  const next = digits.slice();
  if (next[index]) {
    next[index] = '';
    return { digits: next, focus: index };
  }
  const back = Math.max(0, index - 1);
  next[back] = '';
  return { digits: next, focus: back };
}

/** What a box's own input event means: the box held `before` and now holds `value`. */
export function typedInto(before, value) {
  const digits = digitsOnly(value);
  if (digits.length <= 1 || !before) return digits;
  // A digit typed beside the one already there: keep the new one. A longer run is a paste or a suggestion.
  if (digits.length === 2) return digits.startsWith(before) ? digits.slice(1) : digits.slice(0, 1);
  return digits;
}

export function codeOf(digits) {
  return digits.join('');
}

export function isComplete(digits) {
  return digits.length > 0 && digits.every((digit) => /^\d$/.test(digit));
}

/**
 * Wires the boxes inside `group`. `onChange(code)` runs on every change. `onComplete(code)` runs when the
 * boxes fill up, or when a full code is typed again up to the last box (a paste or the keyboard's one-time
 * code counts); correcting one digit of a refused PIN waits for Connect instead of sending at once.
 * Returns the controls the page needs.
 */
export function mountOtp(group, { onChange, onComplete }) {
  const boxes = Array.from(group.querySelectorAll('input'));
  let digits = emptyDigits(boxes.length);

  const paint = () => {
    boxes.forEach((box, index) => {
      if (box.value !== digits[index]) box.value = digits[index];
      box.toggleAttribute('data-filled', Boolean(digits[index]));
    });
  };
  const focusBox = (index) => {
    const box = boxes[Math.max(0, Math.min(index, boxes.length - 1))];
    box?.focus({ preventScroll: true });
    box?.select();
  };
  const apply = (result, finishing = false) => {
    const before = codeOf(digits);
    const wasComplete = isComplete(digits);
    digits = result.digits;
    paint();
    focusBox(result.focus);
    const code = codeOf(digits);
    if (code !== before) onChange(code);
    if (!isComplete(digits)) return;
    if (finishing || (!wasComplete && code !== before)) onComplete(code);
  };

  boxes.forEach((box, index) => {
    box.addEventListener('focus', () => box.select());
    box.addEventListener('input', () => {
      const typed = typedInto(digits[index], box.value);
      if (!typed) {
        apply({ digits: digits.map((digit, at) => (at === index ? '' : digit)), focus: index });
        return;
      }
      apply(fillAt(digits, index, typed), index === boxes.length - 1 || typed.length > 1);
    });
    box.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text') ?? '';
      if (!digitsOnly(text)) return;
      event.preventDefault();
      apply(fillAt(digits, index, text), true);
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !box.value) {
        event.preventDefault();
        apply(eraseAt(digits, index));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        focusBox(index + (event.key === 'ArrowLeft' ? -1 : 1));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusBox(event.key === 'Home' ? 0 : boxes.length - 1);
      }
    });
  });

  return {
    value: () => codeOf(digits),
    clear() {
      digits = emptyDigits(boxes.length);
      paint();
    },
    focusFirst: () => focusBox(0),
    focusFirstEmpty: () => focusBox(Math.max(0, digits.indexOf(''))),
    /** 'idle', 'error', 'busy' or 'success'; busy and success lock the boxes. */
    setState(state) {
      group.dataset.state = state;
      for (const box of boxes) {
        box.readOnly = state === 'busy' || state === 'success';
        box.setAttribute('aria-invalid', String(state === 'error'));
      }
    },
  };
}
