// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1, sound's request: an export whose music is the reel's stops at preflight when the template no longer keeps
// its reel (render.media_missing, 'reference audio', with the fix templates.fetchMedia). The fake stops it the same
// way. Exports names the cause as the reel's music, not a missing clip, and the export's end offers "Get the reel's
// video and music", which gets the reel and exports again.
import { callRpc, type RenderId, type TemplateId } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { reelToFetch } from '../src/features/renders/reel-to-fetch';
import { renderApp } from './render-app';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const request = { projectId, timelineId, presetId: 'reels', captions: { burnIn: true, sidecars: [] } };
const CAUSE = 'The reel’s music isn’t kept with its template any more.';

describe('an export whose reel is no longer kept', () => {
  it('stops at preflight with the fix that gets the reel; once it is back, the export goes through', async () => {
    const { client, controls } = createFakeBackend({
      phase2: { library: { tickMs: 0 }, templateMedia: { tickMs: 0 } },
      make: { renderTickMs: 5 },
    });
    const timeline = await client.timelines.get({ timelineId });
    expect(timeline.music.path).toBe('referenceAudio');
    const templateId = timeline.template!.id as TemplateId;
    controls.templates.keepMedia(templateId, null);

    const exportOnce = async () => {
      const sent = await callRpc(
        client.commands.dispatch({ name: 'render.export', payload: request, source: 'ui' }),
      );
      const id = (sent.ok && (sent.value as { result: { renderId: RenderId } }).result.renderId) as RenderId;
      await vi.waitFor(
        async () =>
          expect(['failed', 'ready', 'needsAttention']).toContain(
            (await client.renders.get({ renderId: id })).status,
          ),
        { timeout: 15_000 },
      );
      return client.renders.get({ renderId: id });
    };
    const failed = await exportOnce();
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatchObject({
      code: 'render.media_missing',
      params: { name: 'reference audio' },
      fix: { command: 'templates.fetchMedia', labelKey: 'fix.getReelMedia', payload: { id: templateId } },
    });
    expect(reelToFetch(failed.error)).toBe(templateId);

    expect((await client.templates.fetchMedia({ id: templateId })).media?.hasAudio).toBe(true);
    expect((await exportOnce()).error).toBeNull();
  });

  it('only that fix asks for the reel', () => {
    const missing = {
      code: 'render.media_missing',
      messageKey: 'errors.render.media_missing',
      retryable: false,
    };
    expect(reelToFetch(missing)).toBeNull();
    expect(
      reelToFetch({ ...missing, fix: { command: 'templates.fetchMedia', labelKey: 'x', payload: {} } }),
    ).toBeNull();
    expect(reelToFetch(null)).toBeNull();
  });

  it('Exports says why, and "Get the reel’s video and music" gets it and exports again', async () => {
    const { client, controls } = await renderApp('/renders', {
      phase2: { library: { tickMs: 0 }, templateMedia: { tickMs: 0 } },
      make: { renderTickMs: 5 },
    });
    const templateId = (await client.timelines.get({ timelineId })).template!.id as TemplateId;
    controls.templates.keepMedia(templateId, null);
    const before = (await client.renders.list({ projectId })).length;
    await callRpc(client.commands.dispatch({ name: 'render.export', payload: request, source: 'ui' }));

    // The moment for an export that ended while Exports was open, and the row: the reel's words, not a clip's.
    const get = await screen.findByRole(
      'button',
      { name: 'Get the reel’s video and music' },
      { timeout: 15_000 },
    );
    expect(
      screen.getAllByText((_, node) => node?.textContent?.includes(CAUSE) ?? false).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/A clip in this video is missing/)).toBeNull();

    fireEvent.click(get);
    await waitFor(async () =>
      expect((await client.templates.get({ templateId })).summary.media?.hasAudio).toBe(true),
    );
    // Exported again, with the same preset.
    await waitFor(async () => expect((await client.renders.list({ projectId })).length).toBe(before + 2), {
      timeout: 5_000,
    });
  });
});
