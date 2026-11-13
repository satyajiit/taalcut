// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS as C, defineError } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dispatchCreation, renderCreation } from './create-support';

describe('Create workspace', () => {
  it.each([
    { step: 'script', field: 'Narration', property: 'narration' },
    { step: 'design', field: 'Picture & interaction', property: 'visual' },
  ] as const)(
    'retains unsaved $step edits across scene selection and saves both scenes',
    async ({ step, field, property }) => {
      const { client, project } = await renderCreation(step, true);
      const scenes = within(await screen.findByRole('radiogroup', { name: 'Scenes' }));
      const text = () => screen.getByRole('textbox', { name: field }) as HTMLTextAreaElement;
      const firstEdit = 'The question opens on a shared product canvas.';
      const secondEdit = 'The answer appears beside the original question.';
      expect(text().value).toBe(project.draft!.beats[0]![property]);
      fireEvent.change(text(), { target: { value: firstEdit } });
      fireEvent.click(scenes.getByRole('radio', { name: 'Scene 2' }));
      await waitFor(() => expect(text().value).toBe(project.draft!.beats[1]![property]));
      fireEvent.change(text(), { target: { value: secondEdit } });
      fireEvent.click(scenes.getByRole('radio', { name: 'Scene 1' }));
      await waitFor(() => expect(text().value).toBe(firstEdit));
      const stages = within(screen.getByRole('radiogroup', { name: 'Creation workspace' }));
      expect(stages.getByRole('radio', { name: 'Research' }).getAttribute('aria-disabled')).toBe('true');
      const unsaved = await client.creation.get({ projectId: project.projectId });
      expect(unsaved.draft!.beats[0]![property]).toBe(project.draft!.beats[0]![property]);
      fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }));
      await waitFor(async () => {
        const saved = await client.creation.get({ projectId: project.projectId });
        expect(saved.draft!.beats.map((beat) => beat[property]).slice(0, 2)).toEqual([firstEdit, secondEdit]);
      });
      await waitFor(() =>
        expect(stages.getByRole('radio', { name: 'Research' }).getAttribute('aria-disabled')).not.toBe(
          'true',
        ),
      );
      fireEvent.click(screen.getByRole('radio', { name: 'Scene 2' }));
      await waitFor(() => expect(text().value).toBe(secondEdit));
    },
  );

  it('saves the current brief before researching and passes opaque directory grants', async () => {
    const { client, project } = await renderCreation();
    const title = await screen.findByRole('textbox', { name: 'Video name' });
    fireEvent.change(title, { target: { value: 'Revised launch' } });
    expect(
      (screen.getByRole('button', { name: 'Research & draft script' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('radio', { name: 'Research' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Research & draft script' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add project folder' }));
    await waitFor(async () =>
      expect((await client.creation.get({ projectId: project.projectId })).sources).toHaveLength(1),
    );
    const saved = await client.creation.get({ projectId: project.projectId });
    expect(saved.brief.title).toBe('Revised launch');
    expect(saved.sources[0]).toMatchObject({ kind: 'directory', accessId: 'fake-creation-grant' });
    expect(JSON.stringify(saved.sources)).not.toContain('/Users/');
  });

  it('requires saving visual changes, then approval starts creation and opens the shared editor', async () => {
    const { client, project } = await renderCreation('design', true);
    const direction = await screen.findByRole('textbox', { name: 'Visual direction' });
    fireEvent.change(direction, { target: { value: 'One continuous product canvas with a brand reveal.' } });
    expect(
      (screen.getByRole('button', { name: 'Approve script & design' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }));
    const refresh = await screen.findByRole('button', { name: 'Refresh visual preview' });
    await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Approve script & design' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve script & design' }));
    const editor = (await screen.findAllByRole('link', { name: 'Open editor' }))[0]!;
    const produced = await client.creation.get({ projectId: project.projectId });
    expect(produced.status).toBe('ready');
    expect(produced.draft?.visualDirection).toContain('continuous product canvas');
    await act(async () => fireEvent.click(editor));
    await waitFor(() => expect(document.querySelector('[data-slot=authored-inspector]')).not.toBeNull());
    expect(await screen.findByRole('textbox', { name: 'Text' })).toBeTruthy();
  });

  it('makes charged retry explicit and never sends ordinary resume for an uncertain charge', async () => {
    const { controls } = await renderCreation('production', true, async (client, projectId) => {
      const project = await client.creation.get({ projectId });
      await dispatchCreation(client, C.restore, {
        projectId,
        snapshot: {
          ...project,
          status: 'failed',
          approvedDraftRevision: project.draft!.revision,
          error: defineError('agent.creation_interrupted_charge')(),
          budget: { capMicros: null, spentMicros: 0, reservedMicros: 5000 },
        },
      });
    });
    expect(
      await screen.findByText(
        'The previous provider call may have been charged. Retrying can create another charge.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume creation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry paid work' }));
    await waitFor(() => expect(controls.dispatched.some((item) => item.name === C.retry)).toBe(true));
    expect(controls.dispatched.some((item) => item.name === C.resume)).toBe(false);
  });
});
