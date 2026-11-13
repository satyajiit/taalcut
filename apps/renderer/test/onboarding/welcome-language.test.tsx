// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';
import { freshMac } from './onboarding-dom';

describe('the beta welcome language choices', () => {
  it('starts in English on a Spanish Mac, discloses drafts, and saves an explicit draft choice', async () => {
    const { client } = await renderApp(
      '/onboarding',
      freshMac({
        phase3: { locale: { system: ['es-MX'] } },
      }),
    );
    const group = within(await screen.findByRole('radiogroup', { name: 'Language' }));
    const english = group.getByRole<HTMLInputElement>('radio', { name: 'English' });
    await waitFor(() => expect(english.checked).toBe(true));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByText(/English is supported and used for automatic selection/)).toBeTruthy();
    expect(group.getAllByRole('radio', { name: /Draft translation/ })).toHaveLength(3);
    const spanish = group.getByRole<HTMLInputElement>('radio', { name: /Español.*Draft translation/ });
    await act(async () => {
      fireEvent.click(spanish);
    });
    await waitFor(() => expect(document.documentElement.lang).toBe('es'));
    expect((await client.locale.state()).preference).toBe('es');
    expect(spanish.checked).toBe(true);
  });
});
