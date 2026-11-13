// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-PHN: a phone that scanned the QR asks to pair, and only the person's Allow on the computer lets it in. The
// session hook keeps the latest request and answers it; the dialog shows the phone's name, the number it shows and
// its address, with Deny focused and Escape as Deny, and closes by itself when the request lapses or the phone stops
// asking; the fake's 'approval' scenario through the app: Allow, Deny, no answer, and the dialog over another tab.
import { I18nProvider } from '@lingui/react';
import { transferApprovalSchema, type TransferApproval } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import type { FakeTransferOptions } from '../src/backend/fake/fake-transfer';
import { ApprovalDialog } from '../src/features/library/phone/connect/approval-dialog';
import { FIXTURE_SESSION } from '../src/features/library/phone/session/fixtures';
import { useTransferSession } from '../src/features/library/phone/use-transfer-session';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { renderApp } from './render-app';

const AT = Date.UTC(2026, 9, 13, 9, 30);
const asking: TransferApproval = transferApprovalSchema.parse({
  id: '01K7C5M6Q8APPR0VA100000001',
  sessionId: FIXTURE_SESSION.id,
  state: 'pending',
  device: { label: 'iPhone', platform: 'ios' },
  address: '192.168.1.31',
  matchCode: '47',
  requestedAt: AT,
  expiresAt: AT + 60_000,
});

const QUESTION = 'Allow iPhone to send videos?';

async function fakeBackend(transfer: FakeTransferOptions) {
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  return createFakeBackend({ theme: themeTarget(engine), phase2: { transfer } });
}

describe('the session hook', () => {
  it('keeps the latest request, answers it, and starts a new session with none', async () => {
    const fake = await fakeBackend({ scenario: 'approval', speed: 20 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BackendProvider backend={fake.client}>{children}</BackendProvider>
    );
    const { result } = renderHook(() => useTransferSession(), { wrapper });
    await waitFor(() => expect(result.current.approval?.state).toBe('pending'));
    expect(result.current.approval).toMatchObject({ device: { label: 'iPhone' }, matchCode: '47' });
    let answered: Awaited<ReturnType<typeof result.current.answerApproval>>;
    await act(async () => {
      answered = await result.current.answerApproval(false);
    });
    expect(answered!).toMatchObject({ ok: true, value: { state: 'denied' } });
    expect(result.current.approval?.state).toBe('denied');
    expect(fake.controls.transfer.state().approval?.state).toBe('denied');
    // Starting again is a new session: no request until its phone asks.
    act(() => result.current.restart());
    expect(result.current.approval).toBeNull();
    await waitFor(() => expect(fake.controls.transfer.state().opens).toBe(2));
  });

  it('a request nobody answers lapses on time', async () => {
    const fake = await fakeBackend({ scenario: 'approval', speed: 20, approvalTtlMs: 100 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BackendProvider backend={fake.client}>{children}</BackendProvider>
    );
    const { result } = renderHook(() => useTransferSession(), { wrapper });
    await waitFor(() => expect(result.current.approval?.state).toBe('pending'));
    await waitFor(() => expect(result.current.approval?.state).toBe('expired'));
    expect(result.current.session?.devices).toEqual([]);
  });
});

function dialog(approval: TransferApproval | null, answer = vi.fn(async () => undefined)) {
  const transfer = { approval, session: FIXTURE_SESSION, answerApproval: answer };
  const view = render(
    <I18nProvider i18n={i18n}>
      <ApprovalDialog transfer={transfer} />
    </I18nProvider>,
  );
  const rerender = (next: TransferApproval | null, session = FIXTURE_SESSION) =>
    view.rerender(
      <I18nProvider i18n={i18n}>
        <ApprovalDialog transfer={{ ...transfer, approval: next, session }} />
      </I18nProvider>,
    );
  return { answer, rerender };
}

describe('the dialog', () => {
  it('asks with the phone’s name, the number it shows and its address; Deny has the focus', async () => {
    await activateLocale('en');
    dialog(asking);
    const asked = await screen.findByRole('dialog', { name: QUESTION });
    expect(asked.querySelector('[data-slot=match-code]')?.textContent).toBe('47');
    expect(asked.querySelector('[data-user-content]')?.getAttribute('translate')).toBe('no');
    expect(screen.getByText('192.168.1.31').getAttribute('translate')).toBe('no');
    // Read on opening: the number and the address are in its description.
    const description = document.getElementById(asked.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toContain('47');
    expect(description?.textContent).toContain('192.168.1.31');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deny' })));
  });

  it('Escape is Deny, once however often it is pressed; Allow is Allow', async () => {
    await activateLocale('en');
    let settle: () => void = () => undefined;
    const answer = vi.fn(() => new Promise<undefined>((resolve) => (settle = () => resolve(undefined))));
    dialog(asking, answer);
    await screen.findByRole('dialog', { name: QUESTION });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(answer.mock.calls).toEqual([[false]]);
    await act(async () => settle());
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(answer.mock.calls).toEqual([[false], [true]]);
  });

  it('closes by itself when the request lapses or the phone stops asking', async () => {
    await activateLocale('en');
    for (const state of ['expired', 'withdrawn', 'allowed', 'denied'] as const) {
      const { rerender, answer } = dialog(asking);
      await screen.findByRole('dialog', { name: QUESTION });
      rerender({ ...asking, state });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // Closing by itself answers nothing.
      expect(answer).not.toHaveBeenCalled();
      act(() => rerender(null));
    }
  });

  it('shows nothing while no request waits, or once the session stopped listening', async () => {
    await activateLocale('en');
    const { rerender } = dialog(null);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(asking, { ...FIXTURE_SESSION, state: 'stopped', stopReason: 'closed' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

const approvalApp = async (path: string, transfer: FakeTransferOptions) => {
  const app = await renderApp(path, {
    phase2: { transfer: { scenario: 'approval', speed: 20, ...transfer } },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
  return app;
};

describe('the approval scenario in the app', () => {
  it('Allow lets the phone in, and it sends as the scripted phone does', async () => {
    const { controls } = await approvalApp('/library/phone/wifi', {});
    await screen.findByRole('dialog', { name: QUESTION }, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/Connected to/, {}, { timeout: 4000 })).toBeTruthy();
    expect(controls.transfer.state().approval?.state).toBe('allowed');
    await waitFor(() => expect(controls.transfer.state().session?.totals.files).toBe(4), { timeout: 4000 });
  });

  it('Deny: nothing connects', async () => {
    const { controls } = await approvalApp('/library/phone/wifi', {});
    await screen.findByRole('dialog', { name: QUESTION }, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(controls.transfer.state().approval?.state).toBe('denied');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(controls.transfer.state().session?.devices).toEqual([]);
    expect(screen.getByText('Waiting for your phone')).toBeTruthy();
  });

  it('unanswered, the dialog goes by itself and the connection line says why', async () => {
    const { controls } = await approvalApp('/library/phone/wifi', { approvalTtlMs: 300 });
    await screen.findByRole('dialog', { name: QUESTION }, { timeout: 4000 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 4000 });
    await waitFor(() =>
      expect(document.querySelector('[data-slot=approval-lapsed]')?.textContent).toBe(
        'The request from iPhone ran out of time.',
      ),
    );
    expect(controls.transfer.state().approval?.state).toBe('expired');
    expect(controls.transfer.state().session?.devices).toEqual([]);
  });

  it('shows over the flow’s other tabs too', async () => {
    const { router } = await approvalApp('/library/phone/wifi', { speed: 1 });
    // The session listens once Wi-Fi has shown; the phone asks a moment later, while Transfers is open.
    await screen.findByRole('img', { name: 'QR code to connect your phone' });
    await act(() => router.navigate({ to: '/library/phone/transfers' }));
    await screen.findByRole('dialog', { name: QUESTION }, { timeout: 4000 });
    expect(router.state.location.pathname).toBe('/library/imports');
  });
});
