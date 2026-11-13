// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X2 "Done when" (the window's part): the panel matches the CloudCall log, and its switches are
// person-only commands with no inverse (⌘Z doesn't undo them, the agent can't run them).
import { MODEL_MODULE_IDS, PRIVACY_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { last30Days } from '../src/backend/fake/fake-privacy';
import { renderApp } from './render-app';

const row = (module: string) => document.querySelector<HTMLElement>(`li[data-module="${module}"]`);

describe('Settings › Privacy', () => {
  it('each job’s last 30 days are the CloudCall rows Usage lists for it', async () => {
    const { controls } = await renderApp('/settings/privacy');
    await screen.findByRole('list', { name: 'What each job sends' });
    const records = controls.usage.list({ limit: 10_000 }).records;
    let sending = 0;
    for (const module of MODEL_MODULE_IDS) {
      const element = row(module);
      if (!element) continue;
      const expected = last30Days(records, module, Date.now());
      const numbers = element.querySelector('[data-slot=last-30-days]')?.textContent ?? '';
      if (expected.cloudCalls === 0) {
        expect(numbers, module).toBe('Nothing sent in the last 30 days');
        continue;
      }
      sending += 1;
      const calls = expected.cloudCalls === 1 ? '1 request' : `${expected.cloudCalls} requests`;
      expect(numbers, module).toContain(`${calls} to the cloud`);
      // The same rows by hand: the cloud calls of this job, newest within 30 days.
      const byHand = records.filter(
        (r) => r.module === module && !r.local && r.startedAt >= Date.now() - 30 * 86_400_000,
      );
      expect(byHand.length, module).toBe(expected.cloudCalls);
      expect(
        byHand.reduce((sum, r) => sum + r.bytesSent, 0),
        module,
      ).toBe(expected.bytesSent);
    }
    expect(sending).toBeGreaterThan(0);
  });

  it('the switches are the person’s: dispatched as them, never undone by ⌘Z, refused to the agent', async () => {
    const { controls, client, router } = await renderApp('/settings/privacy', {
      interfaceSounds: { saved: { enabled: true, initialized: true } },
    });
    const localOnly = await screen.findByRole('switch', { name: 'Local only' });
    await act(async () => {
      fireEvent.click(localOnly);
    });
    await waitFor(() => expect(localOnly.getAttribute('aria-checked')).toBe('true'));
    expect(controls.privacy.state().localOnly).toBe(true);
    // A job with no model on this Mac says so.
    await waitFor(() => expect(row('images')?.textContent).toContain('Off while Local only is on'));

    // Turn it off again, then telemetry and crash reports on.
    await act(async () => {
      fireEvent.click(localOnly);
    });
    await waitFor(() => expect(controls.privacy.state().localOnly).toBe(false));
    // UX4 set: Help improve's switches are Privacy's Sharing view.
    await act(async () => {
      await router.navigate({ to: '/settings/privacy/sharing' });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('switch', { name: 'Share usage counts' }));
    });
    await waitFor(() => expect(controls.privacy.state().telemetry.enabled).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Send crash reports' }));
    });
    await waitFor(() => expect(controls.privacy.state().crashReports.enabled).toBe(true));

    expect(controls.dispatched).toEqual([
      { name: PRIVACY_COMMANDS.setLocalOnly, source: 'ui' },
      { name: PRIVACY_COMMANDS.setLocalOnly, source: 'ui' },
      { name: PRIVACY_COMMANDS.setTelemetry, source: 'ui' },
      { name: PRIVACY_COMMANDS.setCrashReports, source: 'ui' },
    ]);
    // No inverse: ⌘Z has nothing to undo, and the switches stay where the person put them.
    expect(await client.commands.undo({ projectId: null })).toBeNull();
    expect(controls.privacy.state().crashReports.enabled).toBe(true);
    const asAgent = await controls.bus.dispatch(
      PRIVACY_COMMANDS.setLocalOnly,
      { enabled: true },
      { source: 'agent', actor: 'agent:test' },
    );
    expect(asAgent.ok).toBe(false);
    expect(controls.privacy.state().localOnly).toBe(false);
  });

  it('a write that fails puts the switch back and says why under it', async () => {
    const { controls } = await renderApp('/settings/privacy/sharing');
    const crash = await screen.findByRole('switch', { name: 'Send crash reports' });
    controls.privacy.failNext(PRIVACY_COMMANDS.setCrashReports);
    await act(async () => {
      fireEvent.click(crash);
    });
    await waitFor(() => expect(crash.getAttribute('aria-invalid')).toBe('true'));
    expect(crash.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-setting=crash-reports] [role=alert]')).toBeTruthy();
  });
});
