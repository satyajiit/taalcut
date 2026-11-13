// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS as C } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dispatchCreation, renderCreation } from './create-support';

describe('authored video range controls', () => {
  it('saves video placement and source trim through the shared editor', async () => {
    const { client, project } = await renderCreation('design', true, async (backend, projectId) => {
      const latest = await backend.creation.get({ projectId });
      await dispatchCreation(backend, C.research, { projectId, revision: latest.revision });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve script & design' }));
    const link = (await screen.findAllByRole('link', { name: 'Open editor' }))[0]!;
    await act(async () => fireEvent.click(link));
    const start = await screen.findByRole('spinbutton', { name: 'Video starts at (seconds)' });
    const ready = await client.creation.get({ projectId: project.projectId });
    const before = await client.creation.inspect({
      projectId: project.projectId,
      timelineId: ready.timelineId!,
    });
    fireEvent.change(start, { target: { value: '2' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Video source in-point (seconds)' }), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Video length (seconds)' }), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save video range' }));
    await waitFor(async () => {
      const timeline = await client.timelines.get({ timelineId: ready.timelineId! });
      expect(timeline.tracks[0]!.items).toMatchObject([
        { type: 'gap', duration: { value: 120 } },
        { type: 'program', sourceStart: { value: 600 }, duration: { value: 900 } },
      ]);
    });
    expect(
      await client.creation.inspect({ projectId: project.projectId, timelineId: ready.timelineId! }),
    ).toEqual(before);
  });
});
