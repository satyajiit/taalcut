// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { IMPORT_METHODS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render-app';

const empty = { phase2: { library: { count: 0 } } };
describe('LIB2 routed imports', () => {
  it.each(IMPORT_METHODS)('opening %s never starts an import, a picker or reception', async (method) => {
    const { controls } = await renderApp(`/library/import/${method}`, empty);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Connection help' })).toBeTruthy());
    expect(controls.dispatched.filter((entry) => entry.name.startsWith('imports.'))).toEqual([]);
    expect(controls.transfer.state().opens).toBe(0);
  });
  it('files go straight to a durable review and start only once from the explicit action', async () => {
    const { router, controls } = await renderApp('/library/import/files', empty);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose files…' }));
    expect(await screen.findByRole('heading', { name: 'Destination' })).toBeTruthy();
    const review = router.state.location.pathname;
    expect(review).toMatch(/^\/library\/import\/files\/[0-9A-Z]{26}\/review$/);
    expect(controls.dispatched.filter((entry) => entry.name === 'imports.start')).toHaveLength(0);
    await act(() => router.navigate({ to: '/library/import' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Review' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(review));
    const start = await screen.findByRole('button', { name: 'Import footage' });
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
    fireEvent.click(start);
    fireEvent.click(start);
    expect(await screen.findByRole('heading', { name: 'File outcomes' })).toBeTruthy();
    expect(controls.dispatched.filter((entry) => entry.name === 'imports.start')).toHaveLength(1);
  });
  it('persists selection through review and Back without importing', async () => {
    const { router, controls } = await renderApp('/library/import/folder', empty);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
    const option = await screen.findByRole('option', { name: /DSC_0001/ });
    fireEvent.click(option);
    await waitFor(() => expect(option.getAttribute('aria-selected')).toBe('true'));
    const review = screen.getByRole('button', { name: 'Review import' });
    // Selection paints before the persisted summary enables navigation.
    await waitFor(() => expect(review.hasAttribute('disabled')).toBe(false));
    fireEvent.click(review);
    expect(await screen.findByRole('heading', { name: 'Destination' })).toBeTruthy();
    await act(() => router.history.back());
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /DSC_0001/ }).getAttribute('aria-selected')).toBe('true'),
    );
    expect(controls.dispatched.filter((entry) => entry.name === 'imports.start')).toHaveLength(0);
    expect(screen.getAllByRole('option').length).toBeLessThan(20);
  });
  it('redirects old phone transfers to phone-filtered Imports', async () => {
    const { router, controls } = await renderApp('/library/phone/transfers', empty);
    await waitFor(() => expect(router.state.location.pathname).toBe('/library/imports'));
    expect(await screen.findByText('Showing phone imports.')).toBeTruthy();
    expect(controls.transfer.state().opens).toBe(0);
  });
  it('keeps Wi-Fi reception alive through Library and Settings navigation', async () => {
    const { router, controls } = await renderApp('/library/import/phone-wifi', {
      phase2: { transfer: { scenario: 'waiting', speed: 20 } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(controls.transfer.state().listening).toBe(true));
    await act(() => router.navigate({ to: '/library/sources' }));
    expect(await screen.findByRole('navigation', { name: 'Library views' })).toBeTruthy();
    await act(() => router.navigate({ to: '/settings/general' }));
    expect(controls.transfer.state().listening).toBe(true);
    expect(controls.transfer.state().opens).toBe(1);
  });
  it('refuses unknown methods and malformed draft ids without dispatch', async () => {
    const { controls } = await renderApp('/library/import/unknown', empty);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull());
    expect(controls.dispatched.filter((entry) => entry.name.startsWith('imports.'))).toEqual([]);
  });
});
