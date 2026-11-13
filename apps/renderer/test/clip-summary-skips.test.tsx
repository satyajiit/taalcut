// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4 gate, the PO's walk: a clip the describe step skipped said "Taalcut didn’t find anything to describe", as if it
// had looked. It says why it has no words instead, with the way on: Analyse again when the model wasn't ready yet,
// Settings › Models when this Mac has none or the frames may not go online. A clip looked at and found empty keeps
// its line.
import { I18nProvider } from '@lingui/react';
import type { AssetDetail, ShotAnalysis } from '@taalcut/core';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { ClipSummary } from '../src/features/library/clip/inspector/clip-summary';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

/** The fixture clip with no description, each shot skipped for `skip` (or looked at and left empty). */
function undescribed(skip?: ShotAnalysis['descriptionSkipped']): AssetDetail {
  return {
    ...CLIP_FIXTURE,
    asset: { ...CLIP_FIXTURE.asset, description: null },
    stages: CLIP_FIXTURE.stages.map((stage) => ({ ...stage, state: 'done' as const })),
    // The summary reads only a shot's words and why they're missing: the rest of an analysis doesn't matter here.
    shots: CLIP_FIXTURE.shots.map((shot) => ({
      ...shot,
      analysis: (skip ? { descriptionSkipped: skip } : {}) as unknown as ShotAnalysis,
    })),
  };
}

/** Renders the summary on the fake backend; `asked` collects the commands it dispatches (the fixture clip isn't in
 * the fake library, so they're asked for, not run). */
async function show(detail: AssetDetail) {
  const fake = createFakeBackend();
  const asked: { name: string; payload: unknown }[] = [];
  // The client's groups are made on each read: the recording wraps the client, as downloads-store.test does.
  const backend = new Proxy(fake.client, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== 'commands' || value === null || !['object', 'function'].includes(typeof value))
        return value;
      return new Proxy(value as object, {
        get(inner, name, innerReceiver) {
          const procedure: unknown = Reflect.get(inner, name, innerReceiver);
          if (name !== 'dispatch' || typeof procedure !== 'function') return procedure;
          return (request: { name: string; payload: unknown }, ...rest: unknown[]) => {
            asked.push({ name: request.name, payload: request.payload });
            return Reflect.apply(procedure, inner, [request, ...rest]);
          };
        },
      });
    },
  });
  const root = createRootRoute({
    component: () => (
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={backend}>
          <ClipSummary detail={detail} />
        </BackendProvider>
      </I18nProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  await act(async () => {
    render(<RouterProvider router={router} />);
    await router.load();
  });
  return asked;
}

describe('a clip with no description says why', () => {
  it('not yet: the model wasn’t ready, and Analyse again starts the clip over', async () => {
    const asked = await show(undescribed('not_yet'));
    expect(screen.getByText('Taalcut couldn’t describe this clip yet.')).toBeTruthy();
    expect(screen.queryByText('Taalcut didn’t find anything to describe in this clip.')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analyse again' }));
    });
    expect(asked).toEqual([
      { name: 'library.reindexAssets', payload: { assetIds: [CLIP_FIXTURE.asset.id] } },
    ]);
  });

  it('no model, or frames it may not send: the way on is Settings › Models', async () => {
    await show(undescribed('no_local_model'));
    expect(screen.getByText('This Mac has no model that can describe clips.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings › Models' }).getAttribute('href')).toBe(
      '/settings/models',
    );
    expect(screen.queryByRole('button', { name: 'Analyse again' })).toBeNull();
  });

  it('frames it may not send online', async () => {
    await show(undescribed('no_consent'));
    expect(
      screen.getByText('Describing this clip would send its frames online, which you haven’t allowed.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings › Models' })).toBeTruthy();
  });

  it('looked at and nothing found keeps its line', async () => {
    await show(undescribed());
    expect(screen.getByText('Taalcut didn’t find anything to describe in this clip.')).toBeTruthy();
  });
});
