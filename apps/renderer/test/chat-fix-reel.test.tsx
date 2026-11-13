// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1: in a chat, the fix that gets a template's reel again (render's `templates.fetchMedia` when the reel's music
// is gone) isn't a bus command. runFix calls the templates service for it; every other fix still goes on the bus.
// The card's sentence for that failure is the reel's, keyed by `params.name`, not a missing clip's.
import { I18nProvider } from '@lingui/react';
import { ok, type FixAction, type TemplateId } from '@taalcut/core';
import { errorMessage, fixLabel, type CardActions } from '@taalcut/ui';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { useChatCardActions } from '../src/chat/card-actions';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { createTestServices } from '../src/services/create';
import { ServicesProvider } from '../src/services/provider';

async function chatActions() {
  await activateLocale('en', 'mac');
  const fake = createFakeBackend({ phase2: { library: { tickMs: 0 }, templateMedia: { tickMs: 0 } } });
  const dispatch = vi.fn(() => Promise.resolve(ok(null)));
  const services = { ...createTestServices({ latencyMs: 0, speed: 0 }, 'mac'), commands: { dispatch } };
  let actions: CardActions | null = null;
  function Harness() {
    actions = useChatCardActions(
      () => undefined,
      () => Promise.resolve(ok(undefined)),
    );
    return null;
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await act(async () => {
    render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>
          <ServicesProvider services={services}>
            <RouterProvider router={router} />
          </ServicesProvider>
        </BackendProvider>
      </I18nProvider>,
    );
    await router.load();
  });
  await waitFor(() => expect(actions).not.toBeNull());
  return { actions: actions!, fake, dispatch };
}

describe('a chat’s fix for a reel that is gone (REF1)', () => {
  it('gets the reel through the templates service, not the bus', async () => {
    const { actions, fake, dispatch } = await chatActions();
    const templateId = (await fake.client.timelines.get({ timelineId: GOLDEN_TIMELINES[0]! })).template!
      .id as TemplateId;
    fake.controls.templates.keepMedia(templateId, null);
    const fix: FixAction = {
      command: 'templates.fetchMedia',
      labelKey: 'fix.getReelMedia',
      payload: { id: templateId },
    };
    const outcome = await actions.runFix!(fix);
    expect(outcome && outcome.ok).toBe(true);
    expect((await fake.client.templates.get({ templateId })).summary.media?.hasAudio).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('still sends every other fix on the bus', async () => {
    const { actions, dispatch } = await chatActions();
    await actions.runFix!({ command: 'sources.choose', labelKey: 'fix.chooseFolder' });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ name: 'sources.choose', source: 'ui' }));
  });

  it('names the missing music, not a missing clip; a clip keeps its sentence', async () => {
    await activateLocale('en', 'mac');
    const missing = (name: string) => ({
      code: 'render.media_missing',
      messageKey: 'errors.render.media_missing',
      retryable: false,
      params: { name },
    });
    expect(errorMessage(i18n, missing('reference audio'))).toBe(
      'The reel’s music isn’t kept with its template any more. Get it again to export with it.',
    );
    expect(errorMessage(i18n, missing('generated music'))).toBe(
      'The music made for this video is gone. Make it again, then export.',
    );
    expect(errorMessage(i18n, missing('music track'))).toBe(
      'Your own track’s file is missing. Reconnect the drive or folder it was on.',
    );
    expect(errorMessage(i18n, missing('01K7C5M6Q8R9S0T1V2W3X4Y5ZB'))).toBe(
      'A clip in this video is missing. Reconnect the drive or folder it was on.',
    );
    // The fix's button reads as the export's does.
    expect(fixLabel(i18n, { command: 'templates.fetchMedia', labelKey: 'fix.getReelMedia' })).toBe(
      'Get the reel’s video and music',
    );
  });
});
