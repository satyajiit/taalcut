// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER: the window follows the download by its events, not by polling. Every view on a backend shares one
// subscription, open while any of them shows; an event that arrives while the first read is out is newer than the
// read's answer, so the answer doesn't overwrite it.
import type { Downloads } from '@taalcut/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BackendProvider } from '../../src/backend/backend';
import type { Backend } from '../../src/backend/contract';
import { createFakeBackend } from '../../src/backend/fake/fake-backend';
import { useDownloads } from '../../src/features/downloads/downloads-store';

function State({ name }: { name: string }) {
  const { downloads } = useDownloads();
  return <p data-testid={name}>{downloads?.state ?? 'none'}</p>;
}

/** The fake's client with subscriptions counted and `system.downloads` answering only once let go. */
function watched(client: Backend) {
  let subscriptions = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const backend = new Proxy(client, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      const group = value !== null && (typeof value === 'object' || typeof value === 'function');
      if (key === 'events' && group)
        return new Proxy(value, {
          get(inner, name, innerReceiver) {
            const procedure: unknown = Reflect.get(inner, name, innerReceiver);
            if (name !== 'subscribe' || typeof procedure !== 'function') return procedure;
            return (...args: unknown[]) => {
              subscriptions += 1;
              return Reflect.apply(procedure, inner, args);
            };
          },
        });
      if (key === 'system' && group)
        return new Proxy(value, {
          get(inner, name, innerReceiver) {
            const procedure: unknown = Reflect.get(inner, name, innerReceiver);
            if (name !== 'downloads' || typeof procedure !== 'function') return procedure;
            return async (...args: unknown[]) => {
              const answer: unknown = await Reflect.apply(procedure, inner, args);
              await gate;
              return answer;
            };
          },
        });
      return value;
    },
  });
  return { backend, subscriptions: () => subscriptions, release };
}

function Views() {
  const [second, setSecond] = useState(true);
  return (
    <>
      <State name="first" />
      {second ? <State name="second" /> : null}
      <button type="button" onClick={() => setSecond(false)}>
        hide
      </button>
    </>
  );
}

describe('following the download', () => {
  it('shares one subscription, and an event newer than the first read wins', async () => {
    const fake = createFakeBackend({ phase2b: { onboarding: { models: 'missing', downloadTickMs: 0 } } });
    const { backend, subscriptions, release } = watched(fake.client);
    await act(async () => {
      render(
        <BackendProvider backend={backend}>
          <Views />
        </BackendProvider>,
      );
    });
    await waitFor(() => expect(subscriptions()).toBe(1));
    // The read is out; meanwhile the download moves on and says so.
    const moved: Downloads = { ...fake.controls.onboarding.downloads(), state: 'paused' };
    // Sent until it arrives: the subscription reaches the fake's bus a moment after it is asked for.
    await waitFor(() => {
      act(() => fake.controls.events.emit('components.downloads', moved));
      expect(screen.getByTestId('first').textContent).toBe('paused');
    });
    expect(screen.getByTestId('second').textContent).toBe('paused');
    // The read's older answer ('missing') arrives last and is dropped.
    await act(async () => {
      release();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('first').textContent).toBe('paused');
    // A view going away keeps the subscription for the one still showing.
    await act(async () => {
      screen.getByRole('button', { name: 'hide' }).click();
    });
    expect(subscriptions()).toBe(1);
  });
});
