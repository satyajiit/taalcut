// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The export dialog's sections (apps/renderer SPEC, "Export dialog sections"): EXPORT_SECTIONS in the SPEC's
// order, each shown only when its feature is there, and each section's control dispatching its command. Since UX4
// the dialog shows them as steps (where it's going, with "For another editor" folded under it; sound; captions;
// framing; credits; then a summary), so each test goes to the step that holds its section.
import { callRpc } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { availableSections, EXPORT_SECTIONS } from '../src/features/renders/sections';
import type { ExportContext } from '../src/features/renders/sections';
import { EXPORT_SECTION_IDS } from '../src/features/renders/sections/types';
import { renderApp } from './render-app';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const EDITOR = `/projects/${projectId}/timeline?timeline=${timelineId}`;

async function contextOf(client: ReturnType<typeof createFakeBackend>['client']): Promise<ExportContext> {
  const [options, timeline] = await Promise.all([
    client.renders.exportOptions({ projectId, timelineId }),
    client.timelines.get({ timelineId }),
  ]);
  const assetIds = [
    ...new Set(
      timeline.tracks.flatMap((track) =>
        track.kind === 'text'
          ? []
          : track.items.flatMap((item) => (item.type === 'clip' ? [item.media.assetId] : [])),
      ),
    ),
  ];
  const credits = await client.library.credits({ assetIds });
  return { projectId, timelineId, options, timeline, style: null, credits: { status: 'ready', credits } };
}

describe('EXPORT_SECTIONS', () => {
  it('lists the sections in the SPEC’s order', () => {
    expect(EXPORT_SECTIONS.map((section) => section.id)).toEqual([...EXPORT_SECTION_IDS]);
    expect(EXPORT_SECTION_IDS).toEqual([
      'where',
      'music',
      'voice',
      'captions',
      'reframe',
      'aiLabel',
      'credits',
      'otherEditors',
    ]);
  });

  it('shows a section only when its feature is there', async () => {
    const { client, controls } = createFakeBackend({
      phase2: { library: { tickMs: 0 } },
      make: { renderTickMs: 0 },
    });
    const plain = await contextOf(client);
    expect(availableSections(plain).map((section) => section.id)).toEqual([
      'where',
      'music',
      'captions',
      'aiLabel',
      'otherEditors',
    ]);
    expect(controls.make.p3.interchange.showcase(projectId, timelineId)).toBe(true);
    expect(availableSections(await contextOf(client)).map((section) => section.id)).toEqual([
      ...EXPORT_SECTION_IDS,
    ]);
    // Without the render lane's credentials note (a Phase 2 backend) there is no AI label; a credits failure shows.
    const older = { ...plain, options: { ...plain.options, credentials: undefined } };
    expect(availableSections(older).map((section) => section.id)).not.toContain('aiLabel');
    const failed = {
      ...plain,
      credits: {
        status: 'error' as const,
        error: { code: 'core.internal', messageKey: 'errors.core.internal', retryable: true },
      },
    };
    expect(availableSections(failed).map((section) => section.id)).toContain('credits');
  });
});

/** A step's name in the stepper, and its heading once it's open. */
const STEP = {
  destination: ['Where it’s going', 'Where it’s going'],
  sound: ['Sound', 'Sound'],
  captions: ['Captions', 'Captions'],
  framing: ['Framing', 'Framing'],
  credits: ['Credits', 'Credits and labels'],
  summary: ['Summary', 'Ready to export'],
} as const;

/** The sections on the step on screen (a step on its way out is marked leaving). */
const sectionsOn = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll('[data-slot=step-layer]:not([data-leaving]) [data-section]')].map((node) =>
    node.getAttribute('data-section'),
  );

async function toStep(dialog: HTMLElement, step: keyof typeof STEP) {
  const [name, heading] = STEP[step];
  const stepper = within(dialog).getByRole('navigation', { name: 'Export steps' });
  await act(async () => fireEvent.click(within(stepper).getByRole('button', { name })));
  await within(dialog).findByRole('heading', { level: 3, name: heading });
}

describe('the export dialog’s sections', () => {
  async function openDialog() {
    const app = await renderApp(EDITOR, { make: { renderTickMs: 0 } });
    await screen.findByRole('button', { name: /^Export/ });
    expect(app.controls.make.p3.interchange.showcase(projectId, timelineId)).toBe(true);
    await act(async () => {
      await app.router.navigate({
        to: '/projects/$projectId/timeline',
        params: { projectId },
        search: { timeline: timelineId, export: true },
      });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await within(dialog).findByRole('heading', { level: 3, name: 'Where it’s going' }, { timeout: 4000 });
    const ran = (prefix: string) => app.controls.dispatched.filter((entry) => entry.name.startsWith(prefix));
    return { ...app, dialog, ran };
  }

  it('shows every section, in order, on its step, with what this timeline has', async () => {
    const { dialog } = await openDialog();
    const stepper = within(dialog).getByRole('navigation', { name: 'Export steps' });
    expect(
      within(stepper)
        .getAllByRole('button')
        .map((button) => button.getAttribute('data-step')),
    ).toEqual(Object.keys(STEP));
    const order: (string | null)[] = [...sectionsOn(dialog)];
    await toStep(dialog, 'sound');
    order.push(...sectionsOn(dialog));
    expect(within(dialog).getByText('Meera')).toBeTruthy();
    expect(within(dialog).getByText('Music Taalcut made for this video')).toBeTruthy();
    expect(within(dialog).getByText('3 sounds, each on a cut.')).toBeTruthy();
    await toStep(dialog, 'captions');
    order.push(...sectionsOn(dialog));
    await toStep(dialog, 'framing');
    order.push(...sectionsOn(dialog));
    expect(
      within(dialog).getByText(/3 clips were shot in another shape and are framed for this one\./),
    ).toBeTruthy();
    await toStep(dialog, 'credits');
    order.push(...sectionsOn(dialog));
    expect(within(dialog).getByText('Video by Ana Lima on Pexels')).toBeTruthy();
    // "For another editor" is folded under the first step's choice.
    expect(order).toEqual([
      'where',
      'otherEditors',
      'music',
      'voice',
      'captions',
      'reframe',
      'aiLabel',
      'credits',
    ]);
  });

  it('AI label: off by default; on is a person’s render.setContentCredentials, with the certificate and reminders', async () => {
    const { dialog, ran } = await openDialog();
    await toStep(dialog, 'credits');
    const toggle = within(dialog).getByRole('switch', { name: 'Add Content Credentials (C2PA)' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // A model made parts of it: the reminders show either way, Reels (this export's app) open first.
    const reminders = dialog.querySelector(
      '[data-slot=step-layer]:not([data-leaving]) [data-slot=disclosures]',
    );
    expect(reminders?.querySelectorAll('[data-platform]')).toHaveLength(3);
    await act(async () => fireEvent.click(toggle));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(ran('render.setContentCredentials')).toEqual([
      { name: 'render.setContentCredentials', source: 'ui' },
    ]);
    expect(within(dialog).getByText(/Signed with a test certificate/)).toBeTruthy();
  });

  it('music, voice and reframe dispatch their commands', async () => {
    const { dialog, ran, client } = await openDialog();
    await toStep(dialog, 'sound');
    await act(async () =>
      fireEvent.click(within(dialog).getByRole('switch', { name: 'Lower the music under the voice' })),
    );
    await waitFor(() => expect(ran('music.setDucking')).toHaveLength(1));
    await act(async () => fireEvent.click(within(dialog).getByRole('switch', { name: 'Hits on the cuts' })));
    await waitFor(() => expect(ran('sfx.setHits')).toHaveLength(1));
    await act(async () =>
      fireEvent.click(within(dialog).getByRole('switch', { name: 'Voiceover in the video' })),
    );
    await waitFor(() => expect(ran('voice.removeVoiceover')).toHaveLength(1));
    expect((await client.timelines.get({ timelineId })).voiceover).toBeNull();
    // Putting it back undoes the take-out while it is the newest change.
    await act(async () =>
      fireEvent.click(within(dialog).getByRole('switch', { name: 'Voiceover in the video' })),
    );
    await waitFor(async () =>
      expect((await client.timelines.get({ timelineId })).voiceover?.voiceName).toBe('Meera'),
    );
    await toStep(dialog, 'framing');
    await act(async () => fireEvent.click(within(dialog).getByRole('switch', { name: 'Smart reframe' })));
    await waitFor(() => expect(ran('timeline.setReframe')).toHaveLength(3));
    const history = await callRpc(client.commands.history({ projectId }));
    expect(history.ok ? history.value.undo : null).toBe('timeline.setReframe');
  });

  it('credits Copy puts the lines on the clipboard; pro export writes, warns and saves', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { dialog, ran } = await openDialog();
    // Pro export waits under the first step's fold.
    await act(async () =>
      fireEvent.click(within(dialog).getByRole('button', { name: 'Or take the cut to another editor' })),
    );
    const otio = dialog.querySelector('[data-format=otio]') as HTMLElement;
    await act(async () => fireEvent.click(within(otio).getByRole('button', { name: 'Write the file' })));
    await within(otio).findByText(/text items become markers with their words/);
    expect(ran('timeline.exportInterchange')).toEqual([{ name: 'timeline.exportInterchange', source: 'ui' }]);
    await act(async () => fireEvent.click(within(otio).getByRole('button', { name: 'Save as…' })));
    expect(await within(otio).findByText(/Saved a copy as/)).toBeTruthy();
    await toStep(dialog, 'credits');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' })));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '"Whoosh short" by kinoton (https://freesound.org/s/612091/) licensed under CC BY 4.0\nVideo by Ana Lima on Pexels',
      ),
    );
    expect(await within(dialog).findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('the summary says what each step chose, Change goes back to it, and Export starts it', async () => {
    const { dialog, ran } = await openDialog();
    await toStep(dialog, 'summary');
    const summary = dialog.querySelector(
      '[data-slot=step-layer]:not([data-leaving]) [data-slot=export-summary]',
    );
    expect(summary).not.toBeNull();
    expect(within(summary as HTMLElement).getByText('Where it’s going')).toBeTruthy();
    await act(async () =>
      fireEvent.click(within(summary as HTMLElement).getByRole('button', { name: 'Change Sound' })),
    );
    await within(dialog).findByRole('heading', { level: 3, name: 'Sound' });
    await toStep(dialog, 'summary');
    expect(ran('render.export')).toEqual([]);
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /^Export for/ })));
    await waitFor(() => expect(ran('render.export')).toEqual([{ name: 'render.export', source: 'ui' }]));
  });
});
