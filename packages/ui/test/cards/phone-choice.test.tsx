// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B4, P3-B5: the source picker's "From my phone" opens Wi-Fi or a cable, the cable first when a phone is already
// on one, and shows whatever panel the app gives for the chosen way. Without the app's panel it keeps Connect phone.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Card } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  CardDataProvider,
  CardView,
  type CardActions,
  type CardData,
  type PhoneMethod,
} from '../../src/index';

const picker = (CARD_FIXTURES.sourcePicker.empty ?? CARD_FIXTURES.sourcePicker.sources) as Card;
const wrap = (node: ReactNode, data: CardData, actions: CardActions = { navigate: vi.fn() }) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>
        <CardDataProvider value={data}>{node}</CardDataProvider>
      </CardActionsProvider>
    </I18nProvider>,
  );
const panel = (method: PhoneMethod) => <p data-testid="panel">{`panel for ${method}`}</p>;
const ways = () => screen.getAllByRole('radio').map((radio) => radio.textContent);

describe('source picker, from my phone', () => {
  it('opens the two ways, Wi-Fi first when no phone is on a cable, and shows the chosen panel', async () => {
    const phonePanel = vi.fn(panel);
    wrap(<CardView card={picker} />, { phonePanel });
    const open = screen.getByRole('button', { name: 'From my phone' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await act(async () => {
      fireEvent.click(open);
    });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(ways()).toEqual(['Over Wi-Fi', 'With a cable']);
    expect(screen.queryByTestId('panel')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'With a cable' }));
    });
    expect(screen.getByTestId('panel').textContent).toBe('panel for cable');
    expect(phonePanel).toHaveBeenLastCalledWith('cable');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Over Wi-Fi' }));
    });
    expect(screen.getByTestId('panel').textContent).toBe('panel for wifi');
  });

  it('puts the cable first once a phone is plugged in, and stops watching when it goes', async () => {
    let report: (listed: boolean) => void = () => undefined;
    const stop = vi.fn();
    const watchPhoneOnCable = vi.fn((onChange: (listed: boolean) => void) => {
      report = onChange;
      return stop;
    });
    const { unmount } = wrap(<CardView card={picker} />, { phonePanel: panel, watchPhoneOnCable });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'From my phone' }));
    });
    expect(ways()).toEqual(['Over Wi-Fi', 'With a cable']);
    act(() => report(true));
    expect(ways()).toEqual(['With a cable', 'Over Wi-Fi']);
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it('keeps Connect phone (the Wi-Fi page) without the app’s panel', async () => {
    const navigate = vi.fn();
    wrap(<CardView card={picker} />, {}, { navigate });
    expect(screen.queryByRole('button', { name: 'From my phone' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect phone' }));
    });
    expect(navigate).toHaveBeenCalledWith({ to: 'phone' });
  });
});
