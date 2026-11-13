// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { PRODUCT_COMMANDS, newId, productInputSchema } from '@taalcut/core';
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import { themeTarget } from '../src/backend/fake/expose';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { PRODUCT_DEMO } from '../src/backend/fake/products/product-fixtures';
import { activateLocale } from '../src/i18n/i18n';
import { createAppRouter } from '../src/router';
import { createTestServices } from '../src/services/create';

async function productsPage(path = '/products/new') {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const fake = createFakeBackend({ theme: themeTarget(engine) });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await act(async () => {
    render(<App engine={engine} router={router} backend={fake.client} services={createTestServices()} />);
    await router.load();
  });
  return { ...fake, router };
}

describe('Products workspace', () => {
  it('opens secondary views through their URL and keeps the selected view in navigation history', async () => {
    const { router } = await productsPage(`/products/${PRODUCT_DEMO}?view=knowledge`);
    expect(await screen.findByRole('textbox', { name: 'Search product knowledge' })).toBeTruthy();
    const views = within(screen.getByRole('radiogroup', { name: 'Product workspace' }));
    expect(views.getByRole('radio', { name: 'Knowledge' }).getAttribute('aria-checked')).toBe('true');
    for (const [label, view, region] of [
      ['Videos', 'videos', 'Product videos'],
      ['Publishing', 'publishing', 'Publishing'],
      ['Schedule', 'schedule', 'Background work'],
      ['Activity', 'activity', 'Activity'],
    ] as const) {
      await act(async () => fireEvent.click(views.getByRole('radio', { name: label })));
      expect(await screen.findByRole('region', { name: region })).toBeTruthy();
      expect(new URLSearchParams(router.state.location.searchStr).get('view')).toBe(view);
      expect(views.getByRole('radio', { name: label }).getAttribute('aria-checked')).toBe('true');
    }
    await act(async () => router.history.back());
    expect(await screen.findByRole('region', { name: 'Background work' })).toBeTruthy();
    expect(new URLSearchParams(router.state.location.searchStr).get('view')).toBe('schedule');
  });

  it('keeps dirty product settings in place until discarded or saved', async () => {
    const { client, router } = await productsPage(`/products/${PRODUCT_DEMO}?view=settings`);
    const original = await client.products.get({ productId: PRODUCT_DEMO });
    const name = () => screen.getByRole('textbox', { name: 'Product name' }) as HTMLInputElement;
    await screen.findByRole('textbox', { name: 'Product name' });
    const views = within(screen.getByRole('radiogroup', { name: 'Product workspace' }));
    fireEvent.change(name(), { target: { value: 'An unsaved name' } });
    const videos = views.getByRole('radio', { name: 'Videos' });
    const navigationBlocked = () => videos.matches(':disabled, [aria-disabled="true"]');
    expect(navigationBlocked()).toBe(true);
    fireEvent.click(videos);
    fireEvent.keyDown(views.getByRole('radio', { name: 'Product settings' }), { key: 'ArrowRight' });
    expect(new URLSearchParams(router.state.location.searchStr).get('view')).toBe('settings');
    expect(name().value).toBe('An unsaved name');
    expect((await client.products.get({ productId: PRODUCT_DEMO })).name).toBe(original.name);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(name().value).toBe(original.name);
    expect(navigationBlocked()).toBe(false);
    fireEvent.change(name(), { target: { value: 'A saved product name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(async () =>
      expect((await client.products.get({ productId: PRODUCT_DEMO })).name).toBe('A saved product name'),
    );
    await waitFor(() => expect(navigationBlocked()).toBe(false));
    await act(async () => fireEvent.click(videos));
    expect(await screen.findByRole('region', { name: 'Product videos' })).toBeTruthy();
    await act(async () => fireEvent.click(views.getByRole('radio', { name: 'Product settings' })));
    expect(((await screen.findByRole('textbox', { name: 'Product name' })) as HTMLInputElement).value).toBe(
      'A saved product name',
    );
    expect(new URLSearchParams(router.state.location.searchStr).get('view')).toBe('settings');
  });

  it('creates a product with a read-only folder grant and opens its chosen video in shared creation', async () => {
    const { client, router } = await productsPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Product name' }), {
      target: { value: 'OpenAlly' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'What should Taalcut know?' }), {
      target: { value: 'A local workspace for product teams.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach project folder' }));
    await screen.findByText('Product project');
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));
    const research = await screen.findByRole('button', { name: 'Find video ideas' });
    const product = (await client.products.list({})).items[0]!;
    expect(product.name).toBe('OpenAlly');
    expect(product.sources[0]).toMatchObject({
      kind: 'directory',
      liveCapture: false,
      accessId: 'fake-creation-grant',
    });
    expect(JSON.stringify(product.sources)).not.toContain('/Users/');
    expect(product.preferences).toMatchObject({
      fps: 60,
      resolution: '4k',
      noveltyDays: 30,
      ideaPolicy: 'approval',
    });
    fireEvent.click(research);
    fireEvent.click(await screen.findByRole('button', { name: 'Make this video' }));
    const open = await screen.findByRole('link', { name: 'Open video' });
    const campaign = (await client.products.history({ productId: product.id })).items[0]!;
    const creation = await client.creation.get({ projectId: campaign.projectId });
    expect(creation.brief.formats).toEqual(['9:16']);
    expect(creation.brief.title).toContain('OpenAlly');
    await act(async () => fireEvent.click(open));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/create/${campaign.projectId}`));
  });

  it('paginates beyond 200 products without dropping the tail', async () => {
    const { client } = await productsPage('/products');
    await act(async () => {
      for (let index = 0; index < 205; index++) {
        await client.commands.dispatch({
          name: PRODUCT_COMMANDS.create,
          source: 'ui',
          payload: {
            productId: newId<'Product'>(),
            product: productInputSchema.parse({ name: `Product ${index}` }),
          },
        });
      }
    });
    for (let page = 0; page < 4; page++) {
      const more = await screen.findByRole('button', { name: 'More products' });
      await act(async () => fireEvent.click(more));
    }
    expect(await screen.findByText('Product 204')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More products' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous products' })).toBeTruthy();
  });
});
