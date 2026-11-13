// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../src';
import source from '../src/theme/web-boot.js?raw';

const run = () => new Function(source)();
const root = () => document.documentElement;

describe('web-boot.js', () => {
  it('applies a stored dark choice before the app loads', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run();
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(root().getAttribute('data-theme-preference')).toBe('dark');
  });

  it('leaves <html> to the OS for system or anything unknown', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    run();
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(root().getAttribute('data-theme-preference')).toBe('system');
  });

  it('survives blocked storage', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(run).not.toThrow();
    expect(root().getAttribute('data-theme-preference')).toBe('system');
    spy.mockRestore();
  });
});
