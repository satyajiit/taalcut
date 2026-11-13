// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  codeOf,
  digitsOnly,
  emptyDigits,
  eraseAt,
  fillAt,
  isComplete,
  PIN_LENGTH,
  typedInto,
  // @ts-expect-error phone modules ship as plain JavaScript for the browser.
} from '../../phone/otp.mjs';

const digits = (text: string) => [...text.padEnd(PIN_LENGTH, ' ')].map((digit) => (digit === ' ' ? '' : digit));

describe('typing into the PIN boxes', () => {
  it('has six boxes, empty to start', () => {
    expect(PIN_LENGTH).toBe(6);
    expect(emptyDigits()).toEqual(['', '', '', '', '', '']);
    expect(isComplete(emptyDigits())).toBe(false);
  });

  it('advances to the next box after each digit', () => {
    let state = { digits: emptyDigits(), focus: 0 };
    for (const digit of '482913') state = fillAt(state.digits, state.focus, digit);
    expect(codeOf(state.digits)).toBe('482913');
    expect(state.focus).toBe(5);
    expect(isComplete(state.digits)).toBe(true);
  });

  it('drops anything that is not a digit', () => {
    expect(digitsOnly(' 4-8 2a')).toBe('482');
    expect(fillAt(emptyDigits(), 2, 'x')).toEqual({ digits: emptyDigits(), focus: 2 });
  });

  it('fills every box from a paste or the keyboard suggestion, wherever it lands', () => {
    expect(fillAt(emptyDigits(), 3, '482913')).toEqual({ digits: digits('482913'), focus: 5 });
    expect(fillAt(emptyDigits(), 4, '48 29 13')).toEqual({ digits: digits('482913'), focus: 5 });
    expect(fillAt(emptyDigits(), 4, '4829137').digits).toEqual(digits('482913'));
  });

  it('fills from the box it lands in when the paste is shorter than the PIN', () => {
    expect(fillAt(digits('48'), 2, '29')).toEqual({ digits: digits('4829'), focus: 4 });
  });

  it('keeps the new digit when one is typed beside the digit already in a box', () => {
    expect(typedInto('4', '47')).toBe('7');
    expect(typedInto('4', '74')).toBe('7');
    expect(typedInto('4', '44')).toBe('4');
    expect(typedInto('', '7')).toBe('7');
    expect(typedInto('4', '')).toBe('');
    expect(typedInto('4', '482913')).toBe('482913');
  });
});

describe('Backspace in the PIN boxes', () => {
  it('clears a filled box and stays there', () => {
    expect(eraseAt(digits('4829'), 3)).toEqual({ digits: digits('482'), focus: 3 });
  });

  it('on an empty box, clears the one before and moves back to it', () => {
    expect(eraseAt(digits('482'), 3)).toEqual({ digits: digits('48'), focus: 2 });
    expect(eraseAt(emptyDigits(), 0)).toEqual({ digits: emptyDigits(), focus: 0 });
  });
});
