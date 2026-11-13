// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X1 "Done when" (the window's part): caps are set by people only. The default and each project's cap
// dispatch their commands as the person; undo puts a cap back; the agent is refused.
import { BUDGET_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FLOW_PROJECT_ID } from '../src/backend/fake/fake-projects';
import { renderApp } from './render-app';

/** The window's own start-up commands (the sound preference's first save) can land around a click; only the budget's are in question. */
const budgetCommands = new Set<string>(Object.values(BUDGET_COMMANDS));
const lastBudgetCommand = (dispatched: readonly { name: string; source: string }[]) =>
  dispatched.filter((command) => budgetCommands.has(command.name)).at(-1);

describe('Settings › Usage: budgets', () => {
  it('the default cap: the person’s command, and ⌘Z puts it back', async () => {
    const { controls, client } = await renderApp('/settings/usage/budgets');
    const field = await screen.findByLabelText('Budget for each new project');
    fireEvent.change(field, { target: { value: '3.50' } });
    const row = field.closest('[data-setting=default-cap]') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(controls.budget.defaults().projectCap?.micros).toBe(3_500_000));
    expect(lastBudgetCommand(controls.dispatched)).toEqual({
      name: BUDGET_COMMANDS.setDefaultCap,
      source: 'ui',
    });

    await act(async () => {
      await client.commands.undo({ projectId: null });
    });
    expect(controls.budget.defaults().projectCap?.micros).toBe(2_000_000);
    await waitFor(() =>
      expect((screen.getByLabelText('Budget for each new project') as HTMLInputElement).value).toBe('2.00'),
    );

    // No budget at all is a choice too.
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Give new projects a budget' }));
    });
    await waitFor(() => expect(controls.budget.defaults().projectCap).toBeNull());
  });

  it('a project’s cap: changed from its row, undone from the toast', async () => {
    const { controls } = await renderApp('/settings/usage/budgets');
    const list = await screen.findByRole('list', { name: 'Project budgets' });
    const goa = await waitFor(() => {
      const found = list.querySelector<HTMLElement>(`[data-project="${FLOW_PROJECT_ID}"]`);
      if (!found) throw new Error('no row yet');
      return found;
    });
    await waitFor(() => expect(within(goa).getByRole('meter')).toBeTruthy());
    fireEvent.click(within(goa).getByRole('button', { name: 'Change' }));
    fireEvent.change(within(goa).getByLabelText('Budget for this project'), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(within(goa).getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(controls.budget.project(FLOW_PROJECT_ID).cap?.micros).toBe(5_000_000));
    expect(lastBudgetCommand(controls.dispatched)).toEqual({
      name: BUDGET_COMMANDS.setProjectCap,
      source: 'ui',
    });
    await waitFor(() =>
      expect(within(goa).getByRole('meter').getAttribute('aria-valuetext')).toBe('$1.92 of $5.00 spent'),
    );

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    });
    await waitFor(() => expect(controls.budget.project(FLOW_PROJECT_ID).cap?.micros).toBe(2_000_000));
  });

  it('only a person sets a cap: the agent is refused', async () => {
    const { controls } = await renderApp('/settings/usage/budgets');
    const asAgent = await controls.bus.dispatch(
      BUDGET_COMMANDS.setDefaultCap,
      { cap: { currency: 'USD', micros: 99_000_000 } },
      { source: 'agent', actor: 'agent:test' },
    );
    expect(asAgent.ok).toBe(false);
    expect(controls.budget.defaults().projectCap?.micros).toBe(2_000_000);
  });
});
