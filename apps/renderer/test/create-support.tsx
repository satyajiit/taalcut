// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CREATION_COMMANDS as C,
  FrameRates,
  callRpc,
  newId,
  type CreationBrief,
  type ProjectId,
} from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import { App } from '../src/app';
import type { Backend } from '../src/backend/backend';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { activateLocale } from '../src/i18n/i18n';
import { createAppRouter } from '../src/router';
import { createTestServices } from '../src/services/create';

export const BRIEF: CreationBrief = {
  category: 'product-launch',
  title: 'OpenAlly launch',
  prompt: 'A workspace that answers the next question.',
  audience: 'Product teams',
  callToAction: 'Try OpenAlly',
  formats: ['16:9', '9:16'],
  duration: { value: 1800, rate: FrameRates.fps60 },
  voice: { mode: 'none', voiceId: null, assetId: null, language: 'en' },
};
export const dispatchCreation = (client: Backend, name: string, payload: unknown) =>
  callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));

export async function prepareCreation(client: Backend, research = false) {
  const projectId = newId<'Project'>();
  await dispatchCreation(client, C.create, { projectId, brief: BRIEF });
  if (research) {
    await dispatchCreation(client, C.research, { projectId, revision: 1 });
    const project = await client.creation.get({ projectId });
    await dispatchCreation(client, C.answer, {
      projectId,
      revision: project.revision,
      draftRevision: project.draft!.revision,
      answers: [{ id: 'promise', answer: 'Get to the answer faster.' }],
    });
    const answered = await client.creation.get({ projectId });
    await dispatchCreation(client, C.research, { projectId, revision: answered.revision });
  }
  return client.creation.get({ projectId });
}

export async function renderCreation(
  step = 'brief',
  research = false,
  modify?: (client: Backend, projectId: ProjectId) => Promise<void>,
) {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({ theme: themeTarget(engine), make: { renderTickMs: 0 } });
  const project = await prepareCreation(fake.client, research);
  await modify?.(fake.client, project.projectId);
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/create/${project.projectId}?step=${step}`] }),
  );
  await act(async () => {
    render(<App engine={engine} router={router} backend={fake.client} services={createTestServices()} />);
    await router.load();
  });
  return { client: fake.client, project, router, controls: fake.controls };
}
