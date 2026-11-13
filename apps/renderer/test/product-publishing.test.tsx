// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CREATION_COMMANDS as C,
  PLUGIN_COMMANDS,
  PRODUCT_COMMANDS as P,
  PRODUCT_PUBLISH_COMMANDS,
  RENDER_COMMANDS,
  newId,
  productInputSchema,
} from '@taalcut/core';
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

it('keeps edited copy unposted until exact delivery review and person approval', async () => {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({ theme: themeTarget(engine), make: { renderTickMs: 1 } });
  const client = fake.client;
  const command = (name: string, payload: unknown) =>
    client.commands.dispatch({ name, payload, source: 'ui' });
  const productId = newId<'Product'>();
  await command(P.create, {
    productId,
    product: productInputSchema.parse({
      name: 'OpenAlly',
      sources: [
        {
          id: newId<'CreationSource'>(),
          kind: 'url',
          purpose: 'website',
          label: 'Website',
          url: 'https://example.com',
        },
      ],
      channels: [{ platform: 'youtube', accountId: 'preview-youtube', enabled: true }],
    }),
  });
  await command(P.research, { productId });
  const idea = (await client.products.ideas({ productId })).items[0]!;
  await command(P.choose, { productId, ideaId: idea.id });
  const campaign = (await client.products.history({ productId })).items[0]!;
  const projectId = campaign.projectId;
  await command(C.research, { projectId, revision: 1 });
  let creation = await client.creation.get({ projectId });
  await command(C.answer, {
    projectId,
    revision: creation.revision,
    draftRevision: creation.draft!.revision,
    answers: [{ id: 'promise', answer: 'Find the answer faster.' }],
  });
  creation = await client.creation.get({ projectId });
  // New answers invalidate the prior visual preview; approve the refreshed draft that includes them.
  await command(C.research, { projectId, revision: creation.revision });
  creation = await client.creation.get({ projectId });
  await command(C.approve, {
    projectId,
    revision: creation.revision,
    draftRevision: creation.draft!.revision,
  });
  creation = await client.creation.get({ projectId });
  await command(RENDER_COMMANDS.export, {
    projectId,
    timelineId: creation.timelineId,
    presetId: 'shorts',
    captions: { burnIn: true, sidecars: [] },
    notify: false,
  });
  fake.controls.make.renders.start();
  await waitFor(async () => expect((await client.renders.list({ projectId }))[0]?.status).toBe('ready'));
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/products/${productId}?view=publishing`] }),
  );
  await act(async () => {
    render(<App engine={engine} router={router} backend={client} services={createTestServices()} />);
    await router.load();
  });
  const time = await screen.findByLabelText('Publish time on this device');
  fireEvent.change(time, { target: { value: '2099-12-31T09:00' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare platform copy' }));
  const copy = await screen.findByRole('textbox', { name: 'Caption or description' });
  fireEvent.change(copy, { target: { value: 'An edited, verified product workflow.' } });
  expect(await client.productPublishing.list({ campaignId: campaign.id })).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save posts for final approval' }));
  const approve = await screen.findByRole('button', { name: 'Approve this post and schedule' });
  const rows = await client.productPublishing.list({ campaignId: campaign.id });
  expect(rows[0]).toMatchObject({
    status: 'draft',
    content: 'An edited, verified product workflow.',
    approvalHash: null,
  });
  expect(fake.controls.dispatched.some((item) => item.name === PRODUCT_PUBLISH_COMMANDS.dispatch)).toBe(
    false,
  );
  fireEvent.click(approve);
  await waitFor(async () =>
    expect((await client.productPublishing.list({ campaignId: campaign.id }))[0]?.status).toBe('scheduled'),
  );
  expect(await screen.findByRole('link', { name: 'Connect Instagram Edits in Settings' })).toBeTruthy();
  await act(async () => {
    await client.pluginsSetup.importCredential({
      pluginId: 'instagram-edits',
      credentialId: 'access-token',
    });
    await command(PLUGIN_COMMANDS.setAccess, {
      pluginId: 'instagram-edits',
      access: ['projects-write'],
    });
    await command(PLUGIN_COMMANDS.setEnabled, {
      pluginId: 'instagram-edits',
      enabled: true,
    });
  });
  const audioInput = await screen.findByLabelText('Instagram audio ID (optional)');
  fireEvent.change(audioInput, { target: { value: '39980524774894524' } });
  fireEvent.click(screen.getByRole('button', { name: 'Stage in Instagram Edits' }));
  expect(
    await screen.findByText('Staged in Instagram Edits. Open the Edits app to add collaborators and share.'),
  ).toBeTruthy();
  expect(fake.controls.plugins.calls).toContainEqual(
    expect.objectContaining({
      pluginId: 'instagram-edits',
      toolName: 'api.stageReel',
      input: expect.objectContaining({
        audioAssetId: '39980524774894524',
        duckAudio: true,
      }),
    }),
  );
});
