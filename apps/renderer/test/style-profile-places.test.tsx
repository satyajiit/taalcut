// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, RENDER_COMMANDS, TEMPLATE_COMMANDS, type TemplateFolder } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { styleSourceOfView } from '../src/features/templates/profiles/view-style-source';
import { renderApp } from './render-app';

const TRAVEL = { id: newId<'TemplateFolder'>(), name: 'Travel' };
const FOLDERS: TemplateFolder[] = [{ ...TRAVEL, createdAt: 0, templates: 1 }];
const card = (name = 'What these templates have in common') => screen.findByRole('region', { name });

describe('which set a view of Templates shows whole (LRN1-STY)', () => {
  it('is a known folder with no words or filter, or one tag over every template with no other filter', () => {
    expect(styleSourceOfView({ folder: TRAVEL.id }, '', FOLDERS, 3)).toEqual({
      kind: 'folder',
      folderId: TRAVEL.id,
    });
    expect(styleSourceOfView({ tags: 'hooks' }, '', FOLDERS, 3)).toEqual({ kind: 'tag', tag: 'hooks' });
    // The sort doesn't change the set.
    expect(styleSourceOfView({ tags: 'hooks', sort: 'name' }, '', FOLDERS, 3)).toEqual({
      kind: 'tag',
      tag: 'hooks',
    });
  });

  it('is no set for search results, several tags, a narrowed view, Favourites, or a folder the rail doesn’t know', () => {
    expect(styleSourceOfView({ folder: TRAVEL.id }, 'market', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ tags: 'hooks' }, 'market', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ tags: 'hooks,travel' }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ tags: 'hooks', format: 'vlog' }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ tags: 'hooks', stale: true }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ folder: TRAVEL.id, tags: 'hooks' }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ folder: TRAVEL.id, length: 'short' }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ folder: 'favourites' }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ folder: 'unfiled' }, '', FOLDERS, 3)).toBeNull();
    expect(styleSourceOfView({ folder: TRAVEL.id }, '', undefined, 3)).toBeNull();
    expect(styleSourceOfView({}, '', FOLDERS, 3)).toBeNull();
  });

  it('is no card for an empty list, or one still loading: the list says what fills it', () => {
    expect(styleSourceOfView({ folder: TRAVEL.id }, '', FOLDERS, 0)).toBeNull();
    expect(styleSourceOfView({ tags: 'hooks' }, '', FOLDERS, 0)).toBeNull();
    expect(styleSourceOfView({ tags: 'hooks' }, '', FOLDERS, undefined)).toBeNull();
  });
});

describe('a set’s card where the set lives (LRN1-STY)', () => {
  it('a folder’s view has its card above the list; words take it away', async () => {
    await renderApp('/templates');
    const rail = await screen.findByRole('navigation', { name: 'Template folders' });
    // The fake's Travel folder holds the Golden hour template, one of its three.
    // A folder is a page (UX4 tpl): the rail's places are links.
    fireEvent.click(await within(rail).findByRole('link', { name: /^Travel/ }));
    const found = await card();
    expect(within(found).getByRole('heading', { level: 3 })).toBeTruthy();
    expect(within(found).getByText('Measured from 1 template')).toBeTruthy();
    expect(found.querySelector('[data-slot="style-profile-one"]')?.textContent).toContain(
      'Add another to this folder',
    );
    const list = document.querySelector('[data-slot="template-list"]');
    expect(list && found.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a search result list has no card', async () => {
    await renderApp('/templates?tags=travel&q=golden');
    await screen.findByRole('heading', { name: 'Your templates' });
    await waitFor(() => expect(document.querySelector('[data-slot="template-list"]')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'What these templates have in common' })).toBeNull();
  });

  it('one tag’s card reads again when another template is tagged so, and stops being one template’s', async () => {
    const { controls } = await renderApp('/templates?tags=hooks');
    const found = await card();
    expect(within(found).getByText('Measured from 1 template')).toBeTruthy();
    expect(found.querySelector('[data-slot="style-profile-one"]')?.textContent).toContain(
      'Tag another with this',
    );

    const golden = controls.templates.summaries().find((item) => item.name === 'Golden hour market');
    if (!golden) throw new Error('the fake has no Golden hour template');
    await act(async () => {
      const tagged = await controls.bus.dispatch(
        TEMPLATE_COMMANDS.setTags,
        { projectId: null, templateId: golden.id, tags: [...golden.tags, 'hooks'] },
        { source: 'agent', actor: 'agent:test' },
      );
      expect(tagged.ok).toBe(true);
    });
    await waitFor(() => expect(within(found).getByText('Measured from 2 templates')).toBeTruthy());
    expect(found.querySelector('[data-slot="style-profile-one"]')).toBeNull();
    expect(found.querySelectorAll('[data-slot="style-profile-exemplar"]').length).toBeGreaterThan(0);
  });

  it('Your style has what the templates behind your exports have in common', async () => {
    await renderApp('/projects/style');
    const found = await card('What your own videos have in common');
    expect(within(found).getByRole('heading', { level: 2 })).toBeTruthy();
    expect(within(found).getByText('Measured from 1 template')).toBeTruthy();
    expect(found.querySelector('[data-slot="style-profile-one"]')?.textContent).toContain(
      'Export a video made from another template',
    );
  });

  it('an empty folder and a tag with nothing in it keep only the list’s empty state', async () => {
    await renderApp('/templates');
    const rail = await screen.findByRole('navigation', { name: 'Template folders' });
    fireEvent.click(await within(rail).findByRole('link', { name: /^Client work/ }));
    await screen.findByText('Nothing in this folder yet.');
    expect(screen.queryByRole('region', { name: 'What these templates have in common' })).toBeNull();
  });

  it('a tag no template has keeps only “No templates match”', async () => {
    await renderApp('/templates?tags=nothing-here');
    await screen.findByText('No templates match.');
    expect(screen.queryByRole('region', { name: 'What these templates have in common' })).toBeNull();
  });

  it('Your style says how it fills once no finished export comes from a template', async () => {
    // Exports don't move on their own here, so only the deletes change what's finished.
    const { controls } = await renderApp('/projects/style', { make: { renderTickMs: 3_600_000 } });
    await card('What your own videos have in common');
    const fromTemplate = controls.make.renders
      .list()
      .find((render) => render.status === 'ready' && render.name.startsWith('Golden hour market'));
    if (!fromTemplate) throw new Error('the fake has no finished Golden hour export');
    await act(async () => {
      const deleted = await controls.bus.dispatch(
        RENDER_COMMANDS.delete,
        { projectId: fromTemplate.projectId, renderId: fromTemplate.id },
        { source: 'ui', actor: 'user' },
      );
      expect(deleted.ok).toBe(true);
    });
    // Diwali's export is still finished, but no template is behind it: the set is empty, and so is the page's space.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'What your own videos have in common' })).toBeNull(),
    );
    expect(document.querySelector('[data-slot="style-profile-bones"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your style shows up here' })).toBeTruthy();
  });

  it('an Exports page with nothing exported keeps only its empty state; Your style says how it fills', async () => {
    const { router } = await renderApp('/renders', { make: { empty: true } });
    await screen.findByRole('region', { name: 'Exports' });
    expect(screen.queryByRole('region', { name: 'What your own videos have in common' })).toBeNull();
    await act(async () => {
      await router.navigate({ to: '/projects/style' });
    });
    expect(await screen.findByRole('heading', { name: 'Your style shows up here' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'What your own videos have in common' })).toBeNull();
  });
});
