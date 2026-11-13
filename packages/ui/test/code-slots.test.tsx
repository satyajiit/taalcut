// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CodeSlots } from '../src';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

function Wrap({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe('CodeSlots', () => {
  it('renders readOnly pairing PIN slots with data-slot="pin"', () => {
    const { container } = render(
      <Wrap>
        <CodeSlots value="482910" length={6} readOnly aria-label="One-time code" />
      </Wrap>,
    );
    const root = container.querySelector('[data-slot="pin"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('aria-label')).toBe('One-time code');
    expect(root?.textContent).toContain('482910');
  });

  it('supports interactive OTP entry, backspace, and onComplete', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(
      <Wrap>
        <CodeSlots
          length={4}
          defaultValue=""
          onChange={onChange}
          onComplete={onComplete}
          aria-label="Enter verification code"
        />
      </Wrap>,
    );

    const input = screen.getByRole('textbox', { name: 'Enter verification code' });
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: '1' });
    expect(onChange).toHaveBeenLastCalledWith('1');

    fireEvent.keyDown(input, { key: '2' });
    fireEvent.keyDown(input, { key: '3' });
    fireEvent.keyDown(input, { key: '4' });

    expect(onChange).toHaveBeenLastCalledWith('1234');
    expect(onComplete).toHaveBeenCalledWith('1234');

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('123');
  });

  it('renders empty placeholder slots when value is empty in readOnly mode', () => {
    const { container } = render(
      <Wrap>
        <CodeSlots value="" length={6} readOnly placeholderChar="·" aria-label="Empty PIN" />
      </Wrap>,
    );
    const root = container.querySelector('[data-slot="pin"]');
    expect(root?.textContent).toContain('······');
  });
});
