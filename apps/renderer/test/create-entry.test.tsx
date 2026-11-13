// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from '../src/app';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { activateLocale } from '../src/i18n/i18n';
import { createAppRouter } from '../src/router';
import { createTestServices } from '../src/services/create';

it('starts a video from the full idea and chosen category, then opens its saved brief', async () => {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({ theme: themeTarget(engine) });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/create'] }));
  await act(async () => {
    render(<App engine={engine} router={router} backend={fake.client} services={createTestServices()} />);
    await router.load();
  });
  const idea = await screen.findByRole('textbox', { name: 'Your video idea' });
  const start = screen.getByRole('button', { name: 'Start video' }) as HTMLButtonElement;
  fireEvent.change(idea, { target: { value: '   ' } });
  expect(start.disabled).toBe(true);
  const prompt = 'Launch OpenAlly\nShow how a question becomes an answer.\nEnd with an invitation to try it.';
  fireEvent.change(idea, { target: { value: `  ${prompt}  ` } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'custom' } });
  fireEvent.click(start);
  const title = await screen.findByRole('textbox', { name: 'Video name' });
  const projects = await fake.client.creation.list({});
  expect(projects.items).toHaveLength(1);
  const project = projects.items[0]!;
  expect(project.brief).toMatchObject({ title: 'Launch OpenAlly', prompt, category: 'custom' });
  await waitFor(() => expect(router.state.location.pathname).toBe(`/create/${project.projectId}`));
  expect((title as HTMLInputElement).value).toBe('Launch OpenAlly');
  expect(
    (screen.getByRole('textbox', { name: 'What should the video say?' }) as HTMLTextAreaElement).value,
  ).toBe(prompt);
  expect(
    fake.controls.dispatched.filter((command) => command.name === CREATION_COMMANDS.create),
  ).toHaveLength(1);
});
