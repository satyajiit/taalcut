// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 (W2-6): every step has a visible Back beside Continue, the rail never says "Step 0" or changes size under the
// person, the last step has the same footer as the others, a terms step says what skipping means, and nothing that
// stops Continue is silent (the agreement not saved, the build not read). UX4: footage first, and the old steps'
// addresses (and a progress saved at one) still land somewhere.
import { TimeoutError } from '@taalcut/core';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  beforeTerms,
  linkedStep,
  previousStep,
  railSteps,
  resumeStep,
  stepsFor,
} from '../../src/onboarding/steps';
import { renderApp } from '../render-app';
import { continueButton, el, freshMac, openWay, press, startImport } from './onboarding-dom';
import { renderWith } from './render-with';

const stable = stepsFor({ alpha: false, beta: false });
const alphaBuild = stepsFor({ alpha: true, beta: false });
const onAlpha = freshMac({ phase3: { updates: { channel: 'alpha' } } });
const actions = () => el('[data-slot=step-actions]');

describe('the steps around the open one', () => {
  it('Back goes to the step before in this build, and from the first step to the welcome', () => {
    expect(previousStep('sources', stable)).toBeUndefined();
    expect(previousStep('first-video', stable)).toBe('sources');
    expect(previousStep('first-video', alphaBuild)).toBe('alpha');
    // A step this build doesn't list still has a way back.
    expect(previousStep('alpha', stable)).toBe('sources');
  });

  it('the rail always lists the open step, so its count is never 0', () => {
    expect(railSteps('sources', stable)).toBe(stable);
    expect(railSteps('alpha', stable)).toEqual(['sources', 'alpha', 'first-video']);
  });

  it('only the steps before the terms depend on the build', () => {
    expect(beforeTerms('sources')).toBe(true);
    expect(beforeTerms('alpha')).toBe(false);
    expect(beforeTerms('first-video')).toBe(false);
  });

  it('an old step’s address opens the step that holds it now; a progress saved at one resumes on Your videos', () => {
    expect(linkedStep('thinking')).toBe('first-video');
    expect(linkedStep('hardware')).toBe('first-video');
    expect(linkedStep('import')).toBe('sources');
    expect(linkedStep('beta')).toBe('beta');
    expect(resumeStep('thinking')).toBe('sources');
    expect(resumeStep('import')).toBe('sources');
    expect(resumeStep('first-video')).toBe('first-video');
  });
});

describe('first run › the old steps’ addresses', () => {
  it.each([
    ['/onboarding/thinking', '/onboarding/first-video'],
    ['/onboarding/hardware', '/onboarding/first-video'],
    ['/onboarding/import', '/onboarding/sources'],
  ])('%s goes on to %s', async (from, to) => {
    const { router } = await renderApp(from, freshMac());
    await waitFor(() => expect(router.state.location.pathname).toBe(to));
    await screen.findByRole('heading', { level: 1 });
  });

  it('a launch with progress saved at an old step resumes on Your videos', async () => {
    const fresh = freshMac();
    const { router } = await renderApp('/', {
      ...fresh,
      phase2b: {
        onboarding: {
          ...fresh.phase2b.onboarding,
          saved: { step: 'hardware', startedAt: 1, completedAt: null, completedVia: null, branch: {} },
        },
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/sources'));
  });
});

describe('first run › the step actions', () => {
  it('the first step: Back to the welcome, Continue, Skip for now at the row’s end; Step 1 of 2', async () => {
    await renderApp('/onboarding/sources', freshMac());
    await screen.findByRole('heading', { level: 1, name: 'Where are your videos?' });
    const row = within(actions());
    expect(row.getByRole('link', { name: 'Back to Welcome' }).getAttribute('href')).toBe('/onboarding');
    expect(row.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
    // In this order, Skip last (docs/onboarding.md §2, DESIGN.md First run).
    const order = [...actions().querySelectorAll('[data-action]')].map((el) =>
      el.getAttribute('data-action'),
    );
    // The ways in carry their own hooks (folder, Wi-Fi, cable, later); the row's are Back, Continue and Skip.
    expect(order.filter((each) => ['back', 'continue', 'skip'].includes(each ?? ''))).toEqual([
      'back',
      'continue',
      'skip',
    ]);
    await screen.findByText('Step 1 of 2');
  });

  it('a later step: Back names the step before and goes there', async () => {
    const { router } = await renderApp('/onboarding/first-video', freshMac());
    await screen.findByRole('heading', { level: 1 });
    await screen.findByText('Step 2 of 2');
    await press('[data-slot=step-actions] [data-action="back"]');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/sources'));
  });

  it('the first video has the same footer: Back, Make my first video in Continue’s place, Start without a video', async () => {
    await renderApp('/onboarding/first-video', freshMac());
    await screen.findByRole('heading', { level: 1 });
    const row = within(actions());
    expect(row.getByRole('link', { name: 'Back to Your videos' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Make my first video' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Start without a video' })).toBeTruthy();
    expect(row.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    expect(row.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('a terms step says what Skip for now means', async () => {
    await renderApp('/onboarding/alpha', onAlpha);
    await screen.findByRole('button', { name: 'Agree and continue' });
    expect(actions().textContent).toContain(
      'Skip for now finishes setup without agreeing to these terms. You can run setup again from Settings › About.',
    );
  });

  it('an agreement that wasn’t saved says so, and the step stays', async () => {
    const { router } = await renderWith(
      '/onboarding/alpha',
      onAlpha,
      {},
      {
        acknowledgements: {
          has: () => Promise.resolve(false),
          record: () => Promise.reject(new Error('storage is off')),
        },
      },
    );
    await press('[data-action="continue"]');
    await within(actions()).findByRole('alert');
    expect(router.state.location.pathname).toBe('/onboarding/alpha');
    expect(continueButton().hasAttribute('disabled')).toBe(false);
  });

  it('before the terms, a build that can’t be read holds Continue, says why, and offers Try again', async () => {
    await renderWith('/onboarding/sources', freshMac(), {
      'updates.state': { error: TimeoutError({ ms: 5000 }), times: 1 },
    });
    // Your videos is the step before the terms: Continue waits on the build once a way in has something.
    await openWay('folder');
    await startImport();
    await within(actions()).findByText(
      'Taalcut couldn’t check which version this is, so it doesn’t know yet whether there are terms to agree to.',
    );
    expect(continueButton().hasAttribute('disabled')).toBe(true);
    // The rail isn't left as bones: it lists the steps it knows.
    expect(screen.getByRole('navigation', { name: 'Setup steps' })).toBeTruthy();
    await press('[data-slot=step-actions] button:not([data-action])');
    await waitFor(() =>
      expect(
        within(actions()).queryByText(
          'Taalcut couldn’t check which version this is, so it doesn’t know yet whether there are terms to agree to.',
        ),
      ).toBeNull(),
    );
  });

  it('while the saved progress loads, the setup shows bones, not an empty step', async () => {
    await renderWith('/onboarding/sources', freshMac(), { 'onboarding.state': { delayMs: 400 } });
    await screen.findByRole('heading', { level: 1 });
    expect(el('[data-slot=step-setup] .tc-bone')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-slot=step-setup] .tc-bone')).toBeNull());
  });

  it('a phone list that can’t be read offers Try again, which opens it afresh', async () => {
    let unplugged = true;
    await renderWith(
      '/onboarding/sources',
      freshMac({ phase3: { usb: { scenario: 'iphone', tickMs: 20 } } }),
      {
        'imports.sources': { error: TimeoutError({ ms: 5000 }), failWhile: () => unplugged },
      },
    );
    await openWay('cable');
    // The tiles' panel opens under them (UX3), not inside the tile.
    const cable = el('[data-way-panel="cable"]');
    await within(cable).findByRole('alert');
    unplugged = false;
    await press('[data-way-panel="cable"] [data-slot="error-line"] button');
    await waitFor(() => el('[data-action="import-connect"]'));
    expect(within(cable).queryByRole('alert')).toBeNull();
  });

  it('an import status that can’t be read says so with Try again, not bones forever', async () => {
    let down = true;
    await renderWith('/onboarding/sources', freshMac(), {
      'indexing.status': { error: TimeoutError({ ms: 5000 }), failWhile: () => down },
    });
    const setup = el('[data-slot=step-setup]');
    await within(setup).findByRole('alert');
    down = false;
    await press('[data-action="retry-status"]');
    await waitFor(() => expect(within(setup).queryByRole('alert')).toBeNull());
  });
});
