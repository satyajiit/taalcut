// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-MEM follow-up: where a remembered item applies. The choice names a scope only once a project or template is
// picked; an item may move only where core's memoryItemProblems allows (what an export taught stays with a
// template, learned casting weights with every video, an agent's chat stays its own); the picker matches names by
// the start of each word, in any script. On the page: adding for a project picked by name with the keyboard.
import { newId, type MemoryItemView } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  choiceOf,
  disabledKinds,
  EVERY_VIDEO,
  matching,
  sameScope,
  scopeOf,
  scopeProblems,
} from '../../src/features/settings/memory/memory-scope';
import { renderApp } from '../render-app';

const projectId = newId<'Project'>();
const templateId = newId<'Template'>();
const weights = { intent: 1, motion: 1, quality: 1, subject: 1, energy: 1 };

describe('the scope choice', () => {
  it('names a scope only once a project or template is picked', () => {
    expect(scopeOf(EVERY_VIDEO)).toEqual({ kind: 'user' });
    expect(scopeOf({ kind: 'project', target: null })).toBeNull();
    expect(scopeOf({ kind: 'project', target: { id: projectId, name: 'Goa' } })).toEqual({
      kind: 'project',
      projectId,
    });
    expect(scopeOf({ kind: 'template', target: { id: templateId, name: 'Sunset' } })).toEqual({
      kind: 'template',
      templateId,
    });
    expect(scopeOf({ kind: 'project', target: { id: 'not an id', name: 'Goa' } })).toBeNull();
  });

  it("starts an item's editor where the item is, with its name", () => {
    const view = { scope: { kind: 'template', templateId }, scopeName: 'Sunset montage' } as const;
    expect(choiceOf(view)).toEqual({ kind: 'template', target: { id: templateId, name: 'Sunset montage' } });
    expect(choiceOf({ scope: { kind: 'user' }, scopeName: null })).toEqual(EVERY_VIDEO);
  });

  it('lets an item move only where core allows it', () => {
    const written = { source: 'user', data: null, conversationId: null } as const;
    expect(disabledKinds(written)).toEqual([]);
    const worked: Pick<MemoryItemView, 'source' | 'data' | 'conversationId'> = {
      source: 'learned',
      data: {
        kind: 'what-worked',
        templateVersion: 1,
        styleId: null,
        presetId: 'reels',
        renderId: newId<'Render'>(),
        exports: 2,
      },
      conversationId: null,
    };
    expect(disabledKinds(worked)).toEqual(['user', 'project']);
    expect(scopeProblems(worked, { kind: 'user' })).toEqual(["what-worked belongs to a template's scope"]);
    const casting = {
      source: 'learned',
      data: { kind: 'casting-weights', configVersion: 'casting.v1', defaults: weights, weights, pairs: 3 },
      conversationId: null,
    } as const;
    expect(disabledKinds(casting)).toEqual(['project', 'template']);
  });

  it('compares scopes by kind and id', () => {
    expect(sameScope({ kind: 'user' }, { kind: 'user' })).toBe(true);
    expect(sameScope({ kind: 'project', projectId }, { kind: 'project', projectId })).toBe(true);
    expect(
      sameScope({ kind: 'project', projectId }, { kind: 'project', projectId: newId<'Project'>() }),
    ).toBe(false);
    expect(sameScope({ kind: 'user' }, { kind: 'template', templateId })).toBe(false);
  });

  it('matches names by the start of each word, in any script, keeping the order', () => {
    const options = [
      { id: '1', name: 'Golden hour market' },
      { id: '2', name: 'Trip to Goa reel' },
      { id: '3', name: 'दिल्ली की गलियाँ' },
    ];
    expect(matching(options, '').map((o) => o.id)).toEqual(['1', '2', '3']);
    expect(matching(options, 'go').map((o) => o.id)).toEqual(['1', '2']);
    expect(matching(options, 'go mar').map((o) => o.id)).toEqual(['1']);
    expect(matching(options, 'ARKET').map((o) => o.id)).toEqual([]);
    expect(matching(options, 'दिल्ली').map((o) => o.id)).toEqual(['3']);
  });
});

describe('Settings › Memory: adding for a project', () => {
  it('picks the project by name with the keyboard, and Add waits until one is picked', async () => {
    await renderApp('/settings/memory');
    const add = await screen.findByRole('button', { name: 'Add' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Something to remember' }), {
      target: { value: 'Use the chai close-up as the poster.' },
    });
    expect(add).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('radio', { name: 'A project…' }));
    const box = await screen.findByRole('combobox', { name: 'Search projects' });
    expect(add).toHaveProperty('disabled', true);
    fireEvent.change(box, { target: { value: 'golden' } });
    const list = await screen.findByRole('listbox', { name: 'Projects' });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Golden hour market']),
    );
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search projects' })).toBeNull());
    expect(add).toHaveProperty('disabled', false);
    fireEvent.click(add);
    const group = await waitFor(() => {
      const found = document.querySelector('[data-memory-group=project]');
      expect(found?.textContent).toContain('Use the chai close-up as the poster.');
      return found as HTMLElement;
    });
    expect(group.textContent).toContain('Project · Golden hour market');
  });
});
