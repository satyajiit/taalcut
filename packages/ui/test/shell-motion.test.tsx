// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tokens from '../../../design/tokens/tokens.json';
import {
  createIndicatorStore,
  createThemeEngine,
  DUR,
  EASE_IN,
  EASE_IN_OUT,
  EASE_OUT,
  electronStore,
  FOLD_LEAD,
  FOLD_MS,
  foldProgress,
  foldTo,
  FoldLabel,
  horizonReaches,
  localStorageStore,
  onFold,
  onThemeScene,
  originOf,
  runThemeTransition,
  SCENE_MS,
  settleFold,
  SidebarPanel,
  THEME_TRANSITION_ATTRIBUTE,
  ThemeIcon,
  ThemeProvider,
  ThemeToggle,
  type ThemeBridge,
  type ThemeEngine,
} from '../src';
import { washKeyframes } from '../src/theme/theme-scene';

const root = () => document.documentElement;

/**
 * A stand-in for document.startViewTransition: runs the update, finishes when the test says. `updates` holds each
 * transition's updateCallbackDone: the moment the browser takes the new picture and lets the old one go.
 */
function fakeViewTransitions() {
  const finishers: Array<() => void> = [];
  const updates: Promise<void>[] = [];
  const start = vi.fn((update: () => Promise<void> | void) => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => (finish = resolve));
    finishers.push(finish);
    const updateCallbackDone = Promise.resolve().then(update);
    updates.push(updateCallbackDone);
    return {
      ready: new Promise<void>(() => {}),
      finished,
      updateCallbackDone,
    };
  });
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
  return {
    start,
    updates,
    finishAll: async () => {
      for (const finish of finishers.splice(0)) finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** matchMedia with reduced motion on or off (and a light OS). */
function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes('reduced-motion') ? reduce : false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  root().removeAttribute(THEME_TRANSITION_ATTRIBUTE);
  document.querySelector('[data-theme-scene]')?.remove();
  vi.restoreAllMocks();
});

describe('motion constants', () => {
  it('are the design tokens (design/tokens/tokens.json)', () => {
    expect([...EASE_OUT]).toEqual(tokens.easing.out.$value);
    expect([...EASE_IN]).toEqual(tokens.easing.in.$value);
    expect([...EASE_IN_OUT]).toEqual(tokens.easing['in-out'].$value);
    expect(DUR.micro * 1000).toBe(tokens.duration.micro.$value.value);
    expect(DUR.short * 1000).toBe(tokens.duration.short.$value.value);
    expect(DUR.long * 1000).toBe(tokens.duration.long.$value.value);
    expect(FOLD_MS).toBe(tokens.duration.short.$value.value);
    expect(SCENE_MS).toBe(tokens.duration.long.$value.value * 2);
  });
});

describe('runThemeTransition', () => {
  it('just runs the switch where there are no view transitions', async () => {
    const update = vi.fn();
    await runThemeTransition(update, { origin: { x: 10, y: 10 }, scene: 'nightfall' });
    expect(update).toHaveBeenCalledOnce();
    expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(false);
    expect(document.querySelector('[data-theme-scene]')).toBeNull();
  });

  it('plays nightfall from a control: the bodies join the new picture, and all of it goes when it ends', async () => {
    const vt = fakeViewTransitions();
    const ended = vi.fn();
    const off = onThemeScene(ended);
    await runThemeTransition(vi.fn(), { origin: { x: 24, y: 760 }, scene: 'nightfall' });
    expect(root().getAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe('nightfall');
    const stage = document.querySelector('[data-theme-scene=nightfall]');
    expect(stage?.getAttribute('aria-hidden')).toBe('true');
    const parts = [...(stage?.querySelectorAll<HTMLElement>('[data-scene-part]') ?? [])];
    expect(parts.map((p) => p.dataset.scenePart)).toEqual(
      expect.arrayContaining(['tc-scene-sun', 'tc-scene-moon', 'tc-scene-star-1', 'tc-scene-halo']),
    );
    await vt.finishAll();
    expect(root().hasAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe(false);
    expect(document.querySelector('[data-theme-scene]')).toBeNull();
    expect(ended).toHaveBeenCalledWith('nightfall');
    off();
  });

  it('crossfades with no control behind it, and under reduced motion even with one', async () => {
    const vt = fakeViewTransitions();
    await runThemeTransition(vi.fn(), { scene: 'daybreak' });
    expect(root().getAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe('fade');
    await vt.finishAll();
    reducedMotion(true);
    await runThemeTransition(vi.fn(), { origin: { x: 24, y: 760 }, scene: 'daybreak' });
    expect(root().getAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe('fade');
    expect(document.querySelector('[data-theme-scene]')).toBeNull();
    await vt.finishAll();
  });

  it('a click starts from the pointer; the keyboard from the control’s centre', () => {
    const target = document.createElement('button');
    target.getBoundingClientRect = () => ({ left: 10, top: 20, width: 40, height: 20 }) as DOMRect;
    expect(originOf({ clientX: 5, clientY: 6, detail: 1, currentTarget: target })).toEqual({ x: 5, y: 6 });
    expect(originOf({ clientX: 0, clientY: 0, detail: 0, currentTarget: target })).toEqual({ x: 30, y: 30 });
  });
});

describe('the scene’s horizon', () => {
  it('reaches the top first at nightfall and the bottom first at daybreak, within the scene', () => {
    const top = (kind: 'nightfall' | 'daybreak') => horizonReaches(kind, 40, 800);
    const bottom = (kind: 'nightfall' | 'daybreak') => horizonReaches(kind, 770, 800);
    expect(top('nightfall')).toBeLessThan(bottom('nightfall'));
    expect(bottom('daybreak')).toBeLessThan(top('daybreak'));
    for (const t of [top('nightfall'), bottom('nightfall'), top('daybreak'), bottom('daybreak')]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(SCENE_MS);
    }
  });

  it('slides the mask a window and its soft band: down for dusk, up for light', () => {
    expect(washKeyframes('nightfall')).toEqual([
      { maskPosition: '0 -162.5vh' },
      { maskPosition: '0 -37.5vh' },
    ]);
    expect(washKeyframes('daybreak')).toEqual([
      { maskPosition: '0 -37.5vh' },
      { maskPosition: '0 -162.5vh' },
    ]);
  });
});

describe('the theme engine and transitions', () => {
  it('plays nightfall or daybreak for a flip you make, crossfades to Match the Mac, and the rest at once', async () => {
    const vt = fakeViewTransitions();
    const engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
    expect(vt.start).not.toHaveBeenCalled();
    await engine.setPreference('dark', { from: { x: 1, y: 2 } });
    expect(root().getAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe('nightfall');
    expect(root().getAttribute('data-theme')).toBe('dark');
    await vt.finishAll();
    await engine.setPreference('light', { from: { x: 1, y: 2 } });
    expect(root().getAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe('daybreak');
    await vt.finishAll();
    await engine.setPreference('system', { from: { x: 1, y: 2 } });
    expect(root().getAttribute(THEME_TRANSITION_ATTRIBUTE)).toBe('fade');
    await vt.finishAll();
    await engine.setPreference('dark', { instant: true });
    expect(vt.start).toHaveBeenCalledTimes(3);
    expect(root().getAttribute('data-theme')).toBe('dark');
  });

  it('lets the old picture go before main has saved light or dark; Match the Mac waits for main (IX3-F2)', async () => {
    const vt = fakeViewTransitions();
    const saves: Array<() => void> = [];
    const bridge: ThemeBridge = {
      get: async () => 'light',
      set: () => new Promise<void>((resolve) => saves.push(resolve)),
      onChange: () => () => undefined,
    };
    const engine = createThemeEngine({ store: electronStore(bridge) });
    await engine.init();
    let flipped = false;
    const flip = engine.setPreference('dark', { from: { x: 1, y: 2 } }).then(() => void (flipped = true));
    // The new picture is taken while main still has the save in hand; the switch itself ends with main's answer.
    await vt.updates[0];
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(saves).toHaveLength(1);
    expect(flipped).toBe(false);
    saves[0]?.();
    await flip;
    await vt.finishAll();

    // Match the Mac follows the appearance main sets: that picture waits for main.
    let updated = false;
    const toSystem = engine.setPreference('system', { from: { x: 1, y: 2 } });
    void vt.updates[1]?.then(() => void (updated = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saves).toHaveLength(2);
    expect(updated).toBe(false);
    saves[1]?.();
    await toSystem;
    await vt.finishAll();
  });
});

describe('ThemeToggle', () => {
  let engine: ThemeEngine;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={i18n}>
      <ThemeProvider engine={engine}>{children}</ThemeProvider>
    </I18nProvider>
  );
  beforeEach(async () => {
    engine = createThemeEngine({ store: localStorageStore() });
    await engine.init();
  });

  it('says what a click does and flips what you see, from Match the Mac too', async () => {
    render(<ThemeToggle />, { wrapper });
    const button = screen.getByRole('button', { name: 'Switch to dark' });
    expect(button.querySelector('[data-slot=theme-icon]')?.getAttribute('data-theme-icon')).toBe('light');
    await act(async () => fireEvent.click(button, { detail: 1, clientX: 3, clientY: 4 }));
    expect(engine.getState()).toEqual({ preference: 'dark', resolved: 'dark' });
    expect(screen.getByRole('button', { name: 'Switch to light' })).toBe(button);
    expect(button.querySelector('[data-slot=theme-icon]')?.getAttribute('data-theme-icon')).toBe('dark');
    await act(async () => fireEvent.click(button));
    expect(engine.getState().preference).toBe('light');
  });

  it('can be disabled and supports the labelled studio CTA mode', async () => {
    const { rerender } = render(<ThemeToggle disabled />, { wrapper });
    expect((screen.getByRole('button', { name: 'Switch to dark' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ThemeToggle showLabel />);
    // Named by what it shows, the mode too (WCAG 2.5.3).
    const button = screen.getByRole('button', { name: 'Switch to dark Light' });
    expect(button.textContent).toContain('Switch to dark');
    expect(button.textContent).toContain('Light');
    expect(button.hasAttribute('data-mode-gives-way')).toBe(false);
  });

  it('gives the label the mode’s room when it wouldn’t fit beside it, and keeps the mode in its name', () => {
    // jsdom lays nothing out: the label is as a wider font (Linux's) or a longer language makes it.
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(137);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(133);
    try {
      render(<ThemeToggle showLabel />, { wrapper });
      const button = screen.getByRole('button', { name: 'Switch to dark Light' });
      expect(button.hasAttribute('data-mode-gives-way')).toBe(true);
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });
});

describe('ThemeIcon', () => {
  it('draws the sun or the moon, hidden from assistive tech, with ids of its own', () => {
    const { container } = render(
      <>
        <ThemeIcon theme="light" />
        <ThemeIcon theme="dark" delay={300} />
      </>,
    );
    const icons = container.querySelectorAll('svg[data-slot=theme-icon]');
    expect([...icons].map((icon) => icon.getAttribute('data-theme-icon'))).toEqual(['light', 'dark']);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
    const masks = [...container.querySelectorAll('mask')].map((mask) => mask.id);
    expect(new Set(masks).size).toBe(2);
  });
});

describe('the fold clock', () => {
  it('starts a lead in, gives every part the same fold, and turns round from where it is', () => {
    reducedMotion(false);
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    settleFold(false);
    const heard = vi.fn();
    const off = onFold(heard);
    const closing = foldTo(true);
    expect(closing).toMatchObject({ from: 0, to: 1, duration: FOLD_MS, start: 1000 - FOLD_LEAD });
    expect(foldTo(true)).toBe(closing);
    expect(heard).toHaveBeenCalledOnce();
    now = 1000 - FOLD_LEAD + FOLD_MS / 2;
    const halfway = foldProgress();
    expect(halfway).toBeGreaterThan(0.5);
    expect(halfway).toBeLessThan(1);
    const opening = foldTo(false);
    expect(opening.from).toBeCloseTo(halfway);
    expect(opening.duration).toBeCloseTo(FOLD_MS * halfway);
    off();
  });

  it('takes no time under reduced motion', () => {
    reducedMotion(true);
    settleFold(false);
    expect(foldTo(true).duration).toBe(0);
    expect(foldProgress()).toBe(1);
  });
});

describe('SidebarPanel', () => {
  it('folds to the rail and opens again; the words stay for screen readers on the rail without relative/flex classes that push icons left', () => {
    reducedMotion(true);
    const panel = (collapsed: boolean) => (
      <SidebarPanel collapsed={collapsed} aria-label="Sidebar">
        <FoldLabel className="relative flex-1">Library</FoldLabel>
      </SidebarPanel>
    );
    const { rerender, container } = render(panel(false));
    const aside = container.querySelector('[data-slot=sidebar]');
    expect(aside?.hasAttribute('data-rail')).toBe(false);
    expect(screen.getByText('Library').className).toContain('flex-1');
    rerender(panel(true));
    expect(aside?.hasAttribute('data-collapsed')).toBe(true);
    expect(aside?.hasAttribute('data-rail')).toBe(true);
    expect(screen.getByText('Library').className).toBe('sr-only');
    rerender(panel(false));
    expect(aside?.hasAttribute('data-rail')).toBe(false);
    expect(screen.getByText('Library').className).not.toContain('sr-only');
    expect(screen.getByText('Library').className).toContain('flex-1');
  });

  it('scopes CurrentIndicator glide per scope and isolates via IndicatorStore', () => {
    const store = createIndicatorStore();
    const sidebarRow = document.createElement('div');
    const chatRow = document.createElement('div');
    store.setLastRow('sidebar', sidebarRow);
    store.setLastRow('chats', chatRow);
    expect(store.getLastRow('sidebar')).toBe(sidebarRow);
    expect(store.getLastRow('chats')).toBe(chatRow);
    store.reset();
    expect(store.getLastRow('sidebar')).toBeNull();
    expect(store.getLastRow('chats')).toBeNull();
  });
});
