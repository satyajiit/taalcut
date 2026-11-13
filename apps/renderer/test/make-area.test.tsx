// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The Make area's reads (UX1, W2-3): the editor's reads run side by side, and a read that fails says which one
// and reads again (reopening the watch); the projects list and the export dialog's progress do the same.
import { TimeoutError, toRpcError, UnknownError, type TimelineId } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import type { Backend } from '../src/backend/backend';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { orderTimelines, pickActive } from '../src/features/timeline/use-editor-data';
import { activateLocale } from '../src/i18n/i18n';
import { createAppRouter } from '../src/router';
import { createTestServices } from '../src/services/create';

const projectId = GOLDEN_PROJECT;
const [timelineId = '' as TimelineId, second = '' as TimelineId] = GOLDEN_TIMELINES;
const EDITOR = `/projects/${projectId}/timeline?timeline=${timelineId}`;

/** `target` with some of its members swapped (the client is a proxy, so spreading it copies nothing). */
function override<T extends object>(target: T, patch: Partial<T>): T {
  return new Proxy(target, {
    get: (object, key, receiver) =>
      Object.prototype.hasOwnProperty.call(patch, key)
        ? patch[key as keyof T]
        : Reflect.get(object, key, receiver),
  });
}

/** The whole app at `path` on the fake backend, with `wrap` standing between the app and the fake's client. */
async function renderWith(path: string, wrap: (client: Backend) => Backend, editsConnected = false) {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({
    theme: themeTarget(engine),
    today: () => '2026-10-12',
    signInDelayMs: 0,
    make: { renderTickMs: 0 },
    plugins: { editsConnected },
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await act(async () => {
    render(
      <App engine={engine} router={router} backend={wrap(fake.client)} services={createTestServices()} />,
    );
    await router.load();
  });
  return { router, client: fake.client };
}

const timedOut = () => toRpcError(TimeoutError({ ms: 10_000 }));
const editorShows = () =>
  waitFor(() => expect(document.querySelector('[data-slot=timeline-editor]')).not.toBeNull(), {
    timeout: 4000,
  });

describe('pickActive', () => {
  const stray = '01K7C5M6Q8R9S0T1V2W3X4Y5ZZ' as TimelineId;

  it('opens the named video before the list arrives, then the named one if listed, else the first', async () => {
    const list = orderTimelines(await createFakeBackend().client.timelines.listByProject({ projectId }));
    expect(pickActive(timelineId, undefined)).toBe(timelineId);
    expect(pickActive(undefined, undefined)).toBeUndefined();
    expect(pickActive(second, list)).toBe(second);
    expect(pickActive(undefined, list)).toBe(timelineId);
    expect(pickActive(stray, list)).toBe(timelineId);
    expect(pickActive(timelineId, [])).toBeUndefined();
  });
});

describe('the editor’s reads', () => {
  it('opens the named video’s watch while the project and its list are still on their way', async () => {
    const calls: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await renderWith(EDITOR, (client) =>
      override(client, {
        timelines: override(client.timelines, {
          listByProject: async (input, options) => {
            calls.push('list');
            await held;
            calls.push('list done');
            return client.timelines.listByProject(input, options);
          },
          watch: (input, options) => {
            calls.push('watch');
            return client.timelines.watch(input, options);
          },
        }),
      }),
    );
    await waitFor(() => expect(calls).toContain('watch'));
    expect(calls).not.toContain('list done');
    await act(async () => release());
    await editorShows();
  });

  it('a list that didn’t come says which read failed, and Try again reads it again', async () => {
    let failing = true;
    await renderWith(EDITOR, (client) =>
      override(client, {
        timelines: override(client.timelines, {
          listByProject: async (input, options) => {
            if (failing) throw timedOut();
            return client.timelines.listByProject(input, options);
          },
        }),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'This project’s videos didn’t load' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    failing = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    await editorShows();
  });

  it('a watch that failed says the video didn’t open, and Try again reopens the watch', async () => {
    let watches = 0;
    await renderWith(EDITOR, (client) =>
      override(client, {
        timelines: override(client.timelines, {
          watch: async (input, options) => {
            watches += 1;
            if (watches === 1) throw toRpcError(UnknownError());
            return client.timelines.watch(input, options);
          },
        }),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'This video didn’t open' })).toBeTruthy();
    // Not retryable by its code, but reading again is always safe: one Try again beside the line.
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    await editorShows();
    expect(watches).toBe(2);
  });

  it('a project that didn’t open says so, never “gone”', async () => {
    let failing = true;
    await renderWith(EDITOR, (client) =>
      override(client, {
        projects: override(client.projects, {
          get: async (input, options) => {
            if (failing) throw timedOut();
            return client.projects.get(input, options);
          },
        }),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'This project didn’t open' })).toBeTruthy();
    failing = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    await editorShows();
  });
});

describe('the projects list', () => {
  it('a list that didn’t come shows the cause and Try again, then the rows', async () => {
    let failing = true;
    await renderWith('/projects', (client) =>
      override(client, {
        projects: override(client.projects, {
          list: async (input, options) => {
            if (failing) throw timedOut();
            return client.projects.list(input, options);
          },
        }),
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-error-code')).toBe('core.timeout');
    failing = false;
    await act(async () => fireEvent.click(within(alert).getByRole('button', { name: 'Try again' })));
    const rows = await screen.findByRole('list', { name: 'Projects' });
    expect(rows.querySelectorAll('[data-slot=project-row]').length).toBeGreaterThan(0);
  });

  it('shows the active studio workbench on Make without duplicating Instagram Edits', async () => {
    await renderWith('/projects', (client) => client, true);
    expect(await screen.findByRole('region', { name: 'Active studio cut' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Instagram Edits audio tracks' })).toBeNull();
  });

  it('keeps remote Insights audio unavailable while retaining cover art and reel ideas', async () => {
    const requests: unknown[] = [];
    const { router } = await renderWith(
      '/insights',
      (client) =>
        override(client, {
          commands: override(client.commands, {
            dispatch: (input, options) => {
              requests.push(input);
              return client.commands.dispatch(input, options);
            },
          }),
        }),
      true,
    );
    expect(await screen.findByRole('heading', { name: 'Instagram Edits Audio Pulse' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Reel ideas' })).toBeTruthy();

    const trackList = await screen.findByRole('list', { name: 'Instagram Edits audio tracks' });
    const cards = trackList.querySelectorAll('[data-slot=edits-track-card]');
    expect(cards.length).toBeGreaterThan(0);
    const firstCard = cards[0] as HTMLElement;
    expect(firstCard.querySelector('[data-slot=track-cover-art]')).not.toBeNull();
    expect(within(firstCard).getByText('Bender (Reels Sound - Reveal)')).toBeTruthy();
    expect(within(trackList).getAllByText(/Provider: IG licensed/).length).toBeGreaterThan(0);

    expect(within(firstCard).queryByRole('button', { name: 'Play preview' })).toBeNull();
    expect(within(firstCard).getByText('Preview unavailable')).toBeTruthy();
    const cover = within(firstCard).getByRole('button', { name: /Preview unavailable for/ });
    expect((cover as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.click(cover));
    expect(firstCard.hasAttribute('data-playing')).toBe(false);

    const ideaList = await screen.findByRole('list', { name: 'Reel idea starting points' });
    const firstIdeaCard = ideaList.querySelector('[data-slot=reel-idea-card]') as HTMLElement;
    expect(firstIdeaCard.querySelector('[data-slot=reel-idea-stage]')).not.toBeNull();
    const previewReelButton = within(firstIdeaCard).getByRole('button', { name: 'Preview reel' });
    await act(async () => fireEvent.click(previewReelButton));
    expect(firstIdeaCard.getAttribute('data-playing')).toBe('true');
    const pauseReelButton = within(firstIdeaCard).getByRole('button', { name: 'Pause reel' });
    await act(async () => fireEvent.click(pauseReelButton));
    expect(requests.some((request) => JSON.stringify(request).includes('getMusicTrackDetails'))).toBe(false);

    const draftBrief = within(firstCard).getByRole('link', { name: 'Draft brief' });
    await act(async () => fireEvent.click(draftBrief));
    await waitFor(() => expect(router.state.location.pathname).toBe('/create/new'));
    expect(((await screen.findByLabelText('Video name')) as HTMLInputElement).value).toContain(
      'Bender (Reels Sound - Reveal)',
    );
  });
});

describe('the export dialog', () => {
  it('a progress stream that dropped says it lost track and reads again, never “isn’t in the list”', async () => {
    let failing = true;
    const { router } = await renderWith(EDITOR, (client) =>
      override(client, {
        renders: override(client.renders, {
          watch: async (input, options) => {
            if (failing) throw timedOut();
            return client.renders.watch(input, options);
          },
        }),
      }),
    );
    await editorShows();
    await act(async () => {
      await router.navigate({
        to: '/projects/$projectId/timeline',
        params: { projectId },
        search: { timeline: timelineId, export: true },
      });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    // The summary step holds Export (UX4's steps).
    const summary = await within(dialog).findByRole('button', { name: 'Summary' }, { timeout: 4000 });
    await act(async () => fireEvent.click(summary));
    const start = await within(dialog).findByRole('button', { name: /^Export for / });
    await act(async () => fireEvent.click(start));
    expect(
      await within(dialog).findByText('It keeps going. Taalcut lost track of it here; it’s in Exports.'),
    ).toBeTruthy();
    expect(within(dialog).queryByText('This export isn’t in the list any more.')).toBeNull();
    failing = false;
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' })));
    await waitFor(() => expect(dialog.querySelector('[data-slot=render-progress]')).not.toBeNull());
  });
});
