// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CostEstimateCardV2 } from '@taalcut/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardActionsProvider, RunBlock, ToolRunRow, type CardActions } from '../src/index';

const ok = { ok: true as const, value: undefined };
const cost = CARD_FIXTURES.costEstimate.goingAhead as CostEstimateCardV2;
const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );
const closed = () =>
  expect(document.querySelector('[data-slot=run-activity-toggle]')?.getAttribute('aria-expanded')).toBe(
    'false',
  );

describe('activity keeps decisions and useful outcomes reachable', () => {
  it('previews genuine current reasoning without opening steps and preserves a manual expansion', () => {
    const renderRun = (status: 'running' | 'succeeded', thinking: boolean) => (
      <I18nProvider i18n={i18n}>
        <RunBlock status={status} thinking={thinking} preview="Checking whether the final shot is steady.">
          <p>Checking whether the final shot is steady.</p>
        </RunBlock>
      </I18nProvider>
    );
    const view = render(renderRun('running', true));
    const toggle = screen.getByRole('button', { name: 'Activity · Thinking…' });
    closed();
    expect(document.querySelector('[data-slot=run-live-preview]')?.textContent).toBe(
      'Checking whether the final shot is steady.',
    );
    fireEvent.click(toggle);
    expect(document.querySelector('[data-slot=run-live-preview]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    view.rerender(renderRun('succeeded', false));
    expect(screen.getByRole('button', { name: 'Activity' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not invent thinking text during tool-only work or animate beside a streaming answer', () => {
    const view = wrap(<RunBlock status="running" />);
    expect(screen.getByRole('button', { name: 'Activity · Working…' })).toBeTruthy();
    expect(document.querySelector('[data-slot=run-live-preview]')).toBeNull();
    view.unmount();
    wrap(<RunBlock status="running" responding />);
    expect(screen.getByRole('button', { name: 'Activity' })).toBeTruthy();
    expect(document.querySelector('[data-slot=run-live-preview]')).toBeNull();
  });

  it('hides a bare successful exit code but retains meaningful outcomes and developer diagnostics', () => {
    const card = { ...CARD_FIXTURES.toolRun.succeeded!, tool: 'workspace.exec', summary: 'exit 0' };
    const view = wrap(<ToolRunRow card={card} />);
    expect(screen.queryByText('exit 0')).toBeNull();
    view.unmount();
    const developer = wrap(<ToolRunRow card={card} />, { developerMode: true });
    expect(screen.getByText('exit 0')).toBeTruthy();
    developer.unmount();
    wrap(<ToolRunRow card={{ ...card, summary: 'Rendered closing shot', artifactIds: ['closing-shot'] }} />);
    expect(screen.getByText('Rendered closing shot')).toBeTruthy();
    expect(screen.getByText('1 result saved')).toBeTruthy();
  });

  it('keeps a nonzero failure outcome outside the closed activity', () => {
    const card = { ...CARD_FIXTURES.toolRun.failed!, tool: 'workspace.exec', summary: 'exit 1' };
    wrap(<RunBlock tools={[{ card }]} />);
    closed();
    expect(screen.getByText('exit 1').closest('[data-slot=run-activity]')).toBeNull();
  });

  it('lets the person stop live spending without opening activity', async () => {
    const stopRun = vi.fn().mockResolvedValue(ok);
    wrap(<RunBlock costs={[cost]} />, { stopRun });
    closed();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.closest('[data-slot=run-activity]')).toBeNull();
    fireEvent.click(stop);
    await waitFor(() => expect(stopRun).toHaveBeenCalledWith(cost.runId));
    closed();
  });

  it('switches to a cheaper model while activity remains closed', async () => {
    const dispatch = vi.fn().mockResolvedValue(ok);
    wrap(<RunBlock costs={[cost]} />, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: 'Use a cheaper model' }));
    const option = cost.cheaper.find((item) => item.local)!;
    const row = within(screen.getByRole('list', { name: 'Cheaper models' }))
      .getByText(option.model)
      .closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Use this' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('models.setModuleOverride', {
        module: option.module,
        override: { primary: { provider: option.provider, model: option.model } },
      }),
    );
    expect(await screen.findByText(/Switched to/)).toBeTruthy();
    closed();
  });

  it('requires the explicit spending decision even with its activity closed', async () => {
    const asking = CARD_FIXTURES.costEstimate.asking as CostEstimateCardV2;
    const decide = vi.fn().mockResolvedValue({ ok: true, value: 'answered' });
    wrap(<RunBlock costs={[asking]} status="paused" />, { decide });
    closed();
    expect(decide).not.toHaveBeenCalled();
    const spend = screen.getByRole('button', { name: 'Spend it' });
    expect(spend.closest('[data-slot=run-activity]')).toBeNull();
    fireEvent.click(spend);
    await waitFor(() => expect(decide).toHaveBeenCalledWith(asking.approvalId, 'approve'));
    closed();
  });
});
