// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The shared thumb follows a resize in the same frame (UX4, from the make lane): when a face arrives and the options
// narrow, the thumb is back under its option before anything is drawn, never a frame past the track. Make's views
// row in the pseudo-locale caught that frame (`nav[make-views] (too wide: 501 > 494)`) on a busy machine, where
// React's next task came a few frames after the resize.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ViewLink, ViewLinks } from '../src';

const props = ['offsetLeft', 'offsetWidth', 'offsetHeight'] as const;
const saved = props.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
const at = (el: Element) => Number((el as HTMLElement).dataset.testX ?? 0);
const width = (el: Element) => Number((el as HTMLElement).dataset.testW ?? 0);

let resized: (() => void) | null = null;
const realObserver = globalThis.ResizeObserver;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get: function () {
      return at(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: function () {
      return width(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 32 });
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resized = () => callback([], this as unknown as ResizeObserver);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  props.forEach((name, i) => Object.defineProperty(HTMLElement.prototype, name, saved[i]!));
  globalThis.ResizeObserver = realObserver;
  resized = null;
});

describe('the shared thumb on a resize', () => {
  it('is under its option again as soon as the resize is reported, with no frame in between', () => {
    render(
      <I18nProvider i18n={i18n}>
        <ViewLinks label="Resize test">
          <ViewLink href="/a" data-test-x="4" data-test-w="120">
            A
          </ViewLink>
          <ViewLink href="/b" current data-test-x="126" data-test-w="139">
            B
          </ViewLink>
        </ViewLinks>
      </I18nProvider>,
    );
    const thumb = () => document.querySelector<HTMLElement>('[data-slot=segment-thumb]');
    expect(thumb()?.dataset.w).toBe('139');
    // The face arrives: the last option narrows, and the track with it.
    const last = document.querySelector<HTMLElement>('[data-view-current]');
    last?.setAttribute('data-test-w', '128');
    // Reported outside React's act, as the browser does: the thumb is already there when the callback returns.
    const was = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      resized?.();
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = was;
    }
    expect(thumb()?.dataset.w).toBe('128');
    expect(thumb()?.dataset.x).toBe('126');
  });
});
