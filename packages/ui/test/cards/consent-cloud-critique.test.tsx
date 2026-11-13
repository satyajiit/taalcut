// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EAR1-X1: the consent card for `audio.cloudCritique` is the feature's warning: the sound goes to the provider, who
// may keep it on its own terms; the answer is an opinion; the local check stays on this computer. The call names an asset,
// not a file, so no count of files shows. EAR1-R3: the agent names the sound (its file name, label or template's
// name), and the card says which one goes; the tool asks every time, so the card has no Always allow and says why.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardActionsProvider, CardView, type CardActions } from '../../src/index';

const TWO: CardOf<'consent'>['options'] = ['allow-once', 'deny'];

function show(
  providers: string[],
  options: { files?: string[]; choices?: CardOf<'consent'>['options']; actions?: CardActions } = {},
) {
  const pending = CARD_FIXTURES.consent.pending;
  if (!pending) throw new Error('no consent fixture');
  const card: CardOf<'consent'> = {
    ...pending,
    tool: 'audio.cloudCritique',
    upload: { modules: ['vision'], providers, files: options.files ?? [] },
    ...(options.choices ? { options: options.choices } : {}),
  };
  return render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={options.actions ?? {}}>
        <CardView card={card} />
      </CardActionsProvider>
    </I18nProvider>,
  );
}

describe('the consent card for a cloud sound critique', () => {
  it('says the sound goes to the provider, who may keep it, and that the answer is an opinion', () => {
    const { container } = show(['google']);
    expect(screen.getByText(/Critiquing this sound uploads its audio to/)).toBeTruthy();
    expect(container.textContent).toMatch(/a mono copy, never the picture\./);
    expect(container.textContent).toMatch(/may keep it under its own terms/);
    expect(container.textContent).toMatch(/an AI opinion, not a measurement/);
    expect(container.textContent).not.toMatch(/frames of|0 files/);
  });

  it('names no provider when the chain does not say', () => {
    const { container } = show([]);
    expect(container.textContent).toMatch(/uploads its audio to the cloud: .* The provider may keep it/);
  });

  it('names the sound that would go, keeping the warning', () => {
    const { container } = show(['google'], { files: ['Voice memo 14.m4a'], choices: TWO });
    expect(container.textContent).toMatch(
      /Critiquing Voice memo 14\.m4a uploads its audio to Google: a mono copy/,
    );
    expect(container.textContent).toMatch(/Google may keep it under its own terms/);
    expect(container.textContent).not.toMatch(/this sound|1 file/);
    // The name is the person's own: shown as written, apart from the translated words.
    expect(screen.getByText('Voice memo 14.m4a').hasAttribute('data-user-content')).toBe(true);

    const { container: cloud } = show([], { files: ['Morning run'], choices: TWO });
    expect(cloud.textContent).toMatch(
      /Critiquing Morning run uploads its audio to the cloud: .* The provider may/,
    );
  });

  it('never shows a folder, only the name', () => {
    const { container } = show(['google'], { files: ['/Users/asha/Voice Memos/memo.m4a'], choices: TWO });
    expect(container.textContent).toMatch(/Critiquing memo\.m4a uploads/);
    expect(container.textContent).not.toMatch(/Users|asha|Voice Memos/);
  });

  it('offers Allow once and Don’t send only, says it asks every time, and answers once', async () => {
    const decide = vi.fn().mockResolvedValue({ ok: true as const, value: 'answered' as const });
    show(['google'], { files: ['Voice memo 14.m4a'], choices: TWO, actions: { decide } });
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Allow once', "Don't send"]);
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
    expect(screen.getByText('Taalcut asks every time before sending this.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    });
    expect(decide).toHaveBeenCalledWith('ap-consent-1', 'approve', { remember: false });
  });

  it('keeps Always allow, without that line, on a card that offers it', () => {
    show(['google'], { actions: { decide: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeTruthy();
    expect(screen.queryByText('Taalcut asks every time before sending this.')).toBeNull();
  });
});
