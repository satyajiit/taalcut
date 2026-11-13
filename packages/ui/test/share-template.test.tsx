// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { HubShareForm, HubTemplateId, HubTemplateV0, TaalcutError } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareTemplateView, type ShareProblem, type ShareStatus } from '../src/index';
import { STRUCTURE } from './hub-structure-fixture';

const DOCUMENT: HubTemplateV0 = {
  format: 'taalcut.template',
  formatVersion: 0,
  licence: 'CC0-1.0',
  id: '01K7C5M6Q8H000000000000001' as HubTemplateId,
  version: 1,
  name: 'Golden hour',
  description: '',
  handle: 'mira.cuts',
  language: 'en',
  tags: [],
  formatId: null,
  trendFreshness: null,
  forkedFrom: null,
  structure: STRUCTURE,
  style: null,
};

const FORM: HubShareForm = {
  name: 'Golden hour',
  description: '',
  handle: 'mira.cuts',
  tags: [],
  language: 'en',
  includeStyle: false,
};

const LINK: ShareProblem = {
  path: 'structure.slots.3.intent.text',
  rule: 'url',
  slotIndex: 3,
  field: 'text',
};

function wrap(
  props: Partial<{
    status: ShareStatus;
    problems: ShareProblem[];
    acknowledged: boolean;
    error: TaalcutError | null;
    form: HubShareForm;
  }> = {},
) {
  const handlers = {
    onSubmit: vi.fn(),
    onAcknowledge: vi.fn(),
    onShowSlot: vi.fn(),
    onFix: vi.fn(),
    onFormChange: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(
    <I18nProvider i18n={i18n}>
      <ShareTemplateView
        document={DOCUMENT}
        form={props.form ?? FORM}
        problems={props.problems ?? []}
        status={props.status ?? 'ready'}
        acknowledged={props.acknowledged ?? false}
        error={props.error ?? null}
        languages={['en', 'hi']}
        hasLook={false}
        {...handlers}
      />
    </I18nProvider>,
  );
  return { ...view, ...handlers };
}

const submit = () => screen.getByRole('button', { name: /Submit for review|Sending/ });

describe('ShareTemplateView (U3)', () => {
  it('keeps Submit off, with the reason, until "I understand" is ticked and nothing needs fixing', () => {
    const first = wrap();
    expect(submit().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Tick “I understand” to share.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('I understand'));
    expect(first.onAcknowledge).toHaveBeenCalledWith(true);
    first.unmount();

    const blocked = wrap({ acknowledged: true, problems: [LINK] });
    expect(submit().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Fix the things above first.')).toBeTruthy();
    blocked.unmount();

    const noHandle = wrap({ acknowledged: true, form: { ...FORM, handle: '' } });
    expect(submit().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Choose your handle and a name first.')).toBeTruthy();
    noHandle.unmount();

    const ready = wrap({ acknowledged: true });
    expect(submit().hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit());
    expect(ready.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('lists each problem in words with a link to its slot', () => {
    const view = wrap({ problems: [LINK, { path: 'name', rule: 'email', slotIndex: null, field: 'name' }] });
    expect(screen.getByText('2 things to fix first')).toBeTruthy();
    expect(screen.getByText('Slot 4, description')).toBeTruthy();
    expect(screen.getAllByText('It has a web address in it.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show slot 4' }));
    expect(view.onShowSlot).toHaveBeenCalledWith(3);
    // A problem in the form's own field also shows under that field.
    expect(screen.getAllByText('It has an email address in it.')).toHaveLength(2);
  });

  it('shows checking, sending and sent', () => {
    const checking = wrap({ status: 'checking' });
    expect(screen.getByText('Checking what would be sent')).toBeTruthy();
    expect(submit().hasAttribute('disabled')).toBe(true);
    checking.unmount();
    const sending = wrap({ status: 'sending', acknowledged: true });
    expect(submit().getAttribute('aria-busy')).toBe('true');
    sending.unmount();
    const sent = wrap({ status: 'sent' });
    expect(screen.getByRole('status').textContent).toContain('Sent for review.');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(sent.onCancel).toHaveBeenCalled();
  });

  it('says why the hub refused: a rate limit with when, not connected, Local only with Privacy', () => {
    const limited = wrap({
      status: 'refused',
      acknowledged: true,
      error: {
        code: 'hub.rate_limited',
        messageKey: 'errors.hub.rate_limited',
        params: { retryAfterSeconds: 720 },
        retryable: true,
      },
    });
    expect(screen.getByRole('alert').getAttribute('data-error-code')).toBe('hub.rate_limited');
    expect(screen.getByText('You can try again in 12 minutes.')).toBeTruthy();
    expect(submit().hasAttribute('disabled')).toBe(true);
    limited.unmount();

    const unset = wrap({
      status: 'refused',
      error: { code: 'hub.not_configured', messageKey: 'errors.hub.not_configured', retryable: false },
    });
    expect(screen.getByRole('alert').getAttribute('data-error-code')).toBe('hub.not_configured');
    unset.unmount();

    const fix = { command: 'go.privacy', payload: {}, labelKey: 'fix.openPrivacy' };
    const local = wrap({
      status: 'refused',
      error: { code: 'core.local_only', messageKey: 'errors.core.local_only', retryable: false, fix },
    });
    expect(screen.getByText(/Sharing is off while Local only is on/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Privacy' }));
    expect(local.onFix).toHaveBeenCalledWith(fix);
  });

  it('always shows what is not shared', () => {
    for (const status of ['checking', 'ready', 'refused', 'sending'] as const) {
      const view = wrap({ status });
      const list = screen.getByRole('region', { name: 'Not shared' });
      expect(list.textContent).toContain('Your video and its frames');
      expect(list.textContent).toContain('The words on screen');
      view.unmount();
    }
  });
});
