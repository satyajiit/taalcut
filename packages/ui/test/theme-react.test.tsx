// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  createThemeEngine,
  localStorageStore,
  ThemeProvider,
  ThemeSwitcher,
  TooltipProvider,
  useTheme,
  type ThemeEngine,
} from '../src';

async function setup(): Promise<{
  engine: ThemeEngine;
  wrapper: (props: { children: ReactNode }) => ReactNode;
}> {
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={i18n}>
      <TooltipProvider>
        <ThemeProvider engine={engine}>{children}</ThemeProvider>
      </TooltipProvider>
    </I18nProvider>
  );
  return { engine, wrapper };
}

describe('ThemeSwitcher', () => {
  it('shows Match the Mac, Light and Dark as a radio group and switches on click', async () => {
    const { engine, wrapper } = await setup();
    render(<ThemeSwitcher />, { wrapper });
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(screen.getByRole('radio', { name: 'Match the Mac' }).getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(dark));
    expect(engine.getState().preference).toBe('dark');
    expect(dark.getAttribute('aria-checked')).toBe('true');
    expect(dark.tabIndex).toBe(0);
  });

  it('moves and selects with the arrow keys, wrapping round', async () => {
    const { engine, wrapper } = await setup();
    render(<ThemeSwitcher />, { wrapper });
    const group = screen.getByRole('radiogroup');
    await act(async () => fireEvent.keyDown(group, { key: 'ArrowLeft' }));
    expect(engine.getState().preference).toBe('dark');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Dark' }));
    await act(async () => fireEvent.keyDown(group, { key: 'ArrowRight' }));
    expect(engine.getState().preference).toBe('system');
    await act(async () => fireEvent.keyDown(group, { key: 'Enter' }));
    expect(engine.getState().preference).toBe('system');
  });

  it('keeps accessible names when compact', async () => {
    const { wrapper } = await setup();
    render(<ThemeSwitcher compact />, { wrapper });
    const light = screen.getByRole('radio', { name: 'Light' });
    expect(light.textContent).toBe('');
  });
});

describe('useTheme', () => {
  it('reflects engine changes', async () => {
    const { engine, wrapper } = await setup();
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    await act(() => engine.setPreference('light'));
    expect(result.current).toMatchObject({ preference: 'light', resolved: 'light' });
    await act(() => result.current.toggle());
    expect(result.current.resolved).toBe('dark');
  });

  it('fails loudly outside a ThemeProvider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
  });
});
