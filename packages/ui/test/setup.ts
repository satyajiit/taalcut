// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installMatchMedia } from './media';

// jsdom has no canvas, and says so on the console for every try: no 2D context, quietly.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// Outside production builds the macros keep the source message, so an empty
// catalogue renders English.
i18n.loadAndActivate({ locale: 'en', messages: {} });
installMatchMedia(false);

// jsdom has no ResizeObserver (boneyard's Skeleton and ThoughtLine measure with it).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Nor does it scroll: the review brings the thing to check into view in its panel.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.scrollTo ??= function scrollTo() {} as typeof Element.prototype.scrollTo;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  const root = document.documentElement;
  for (const name of ['data-theme', 'data-theme-preference', 'data-theme-switching'])
    root.removeAttribute(name);
  installMatchMedia(false);
});
