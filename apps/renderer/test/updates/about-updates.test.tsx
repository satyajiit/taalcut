// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B9, P3-B14 (the window's part): Settings › Updates (UX4 set: General's view; was a section of About) says what the updater is doing in each state, and the
// channel choice is the person's, with the beta terms recorded before Beta.
import { BETA_TERMS, UPDATE_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeUpdatesOptions } from '../../src/backend/fake/phase3/fake-updates';
import { renderApp } from '../render-app';

const about = (updates: FakeUpdatesOptions) =>
  renderApp('/settings/updates', { phase3: { updates: { checkMs: 0, ...updates } } });

/** Updates is a page of its own now: its status and its channel are the settings page's main content. */
const updatesSection = async () => within(await screen.findByRole('main'));
/** The kit's Radix radio says its state in aria-checked. */
const isChecked = (radio: HTMLElement) => radio.getAttribute('aria-checked') === 'true';

describe('Settings › Updates', () => {
  it('up to date: when it last checked, and Check now runs a check', async () => {
    const { controls } = await about({ channel: 'stable' });
    const section = await updatesSection();
    await section.findByText('Taalcut is up to date');
    expect(section.getByText(/Last checked/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(section.getByRole('button', { name: 'Check now' }));
    });
    await waitFor(() => expect(controls.phase3.updates.watch.get().status.kind).toBe('idle'));
    expect(section.getByText('Taalcut is up to date')).toBeTruthy();
  });

  it('a build without a feed says updates are off and offers no channel', async () => {
    await about({ channel: null });
    const section = await updatesSection();
    await section.findByText('Updates are off in this build');
    expect(section.queryByRole('radiogroup')).toBeNull();
  });

  it('downloading: the version, how far, and a neutral bar with its value', async () => {
    await about({ channel: 'beta', scenario: 'downloading' });
    const section = await updatesSection();
    await section.findByText(/Downloading Taalcut/);
    const bar = section.getByRole('progressbar', { name: 'Update download' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(section.getByText(/only the parts that changed/)).toBeTruthy();
  });

  it('a failed download says why in words, and Try again checks again', async () => {
    const { controls } = await about({ channel: 'stable', scenario: 'error' });
    const section = await updatesSection();
    const line = await section.findByRole('alert');
    expect(line.textContent).toContain('didn’t download cleanly');
    expect(line.getAttribute('data-error-code')).toBe('desktop.update_unreadable');
    await act(async () => {
      fireEvent.click(section.getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => expect(controls.phase3.updates.watch.get().status.kind).toBe('idle'));
    await section.findByText('Taalcut is up to date');
  });

  it('after a rollback: the plain sentence, with both versions', async () => {
    await about({ channel: 'beta', scenario: 'rolled-back' });
    const section = await updatesSection();
    const notice = await section.findByText(/didn’t start, so Taalcut went back to/);
    expect(notice.textContent).toBe(
      'The update to 0.3.0-beta.3 didn’t start, so Taalcut went back to 0.3.0-beta.2. Nothing was lost.',
    );
  });

  it('a team build shows its channel as a fact', async () => {
    await about({ channel: 'alpha' });
    const section = await updatesSection();
    await section.findByText('This is a team build. It updates itself from the alpha channel.');
    expect(section.queryByRole('radiogroup')).toBeNull();
  });

  it('Beta asks for the beta terms first, records them, then switches as the person', async () => {
    const { controls } = await about({ channel: 'stable' });
    const section = await updatesSection();
    const group = await section.findByRole('radiogroup', { name: 'Update channel' });
    expect(isChecked(within(group).getByRole('radio', { name: /Stable/ }))).toBe(true);
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: /Beta/ }));
    });
    // The terms open under Beta; nothing is switched yet.
    const agree = await section.findByRole('button', { name: 'Agree and switch to Beta' });
    expect(section.getByText('Things can still break. Your clips stay on this Mac.')).toBeTruthy();
    expect(controls.phase3.updates.watch.get().choice).toBe('stable');
    await act(async () => {
      fireEvent.click(agree);
    });
    await waitFor(() => expect(controls.phase3.updates.watch.get().choice).toBe('beta'));
    expect(controls.phase3.acknowledgements.has(BETA_TERMS.featureId, BETA_TERMS.termsVersion)).toBe(true);
    expect(controls.dispatched).toContainEqual({ name: UPDATE_COMMANDS.setChannel, source: 'ui' });
    await waitFor(() =>
      expect(section.queryByRole('button', { name: 'Agree and switch to Beta' })).toBeNull(),
    );
    expect(isChecked(within(group).getByRole('radio', { name: /Beta/ }))).toBe(true);
  });

  it('Cancel leaves the channel as it was', async () => {
    const { controls } = await about({ channel: 'stable' });
    const section = await updatesSection();
    const group = await section.findByRole('radiogroup', { name: 'Update channel' });
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: /Beta/ }));
    });
    await act(async () => {
      fireEvent.click(await section.findByRole('button', { name: 'Cancel' }));
    });
    expect(isChecked(within(group).getByRole('radio', { name: /Stable/ }))).toBe(true);
    expect(controls.phase3.updates.watch.get().choice).toBe('stable');
    expect(controls.dispatched.some((each) => each.name === UPDATE_COMMANDS.setChannel)).toBe(false);
  });

  it('back to Stable from a beta says the app keeps its beta until a newer stable', async () => {
    const { controls } = await about({ channel: 'beta' });
    const section = await updatesSection();
    const group = await section.findByRole('radiogroup', { name: 'Update channel' });
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: /Stable/ }));
    });
    await waitFor(() => expect(controls.phase3.updates.watch.get().choice).toBe('stable'));
    const note = await section.findByText(/Taalcut stays on/);
    expect(note.textContent).toBe(
      'Taalcut stays on 0.3.0-beta.2 until a stable version newer than it comes out. Nothing is uninstalled.',
    );
  });
});
