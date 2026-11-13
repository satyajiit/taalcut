// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Consecutive calls retain their grouping within one activity disclosure. Failed calls remain outside it;
// opening the activity reveals useful outcomes, without repeating every call's status and timing.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  groupToolRuns,
  RunBlock,
  tallyToolRuns,
  TOOL_GROUP_LABELS,
  TOOL_LABELS,
  toolGroupFixture,
  toolGroupLabel,
  toolGroupWords,
  ToolRunList,
  type RunTool,
} from '../src/index';

/** A fix that worked (the kit imports only core's types, so no `ok()`). */
const FIXED = { ok: true as const, value: undefined };

/** Renders with the catalogue and a fix to run, kept across a rerender (a run block that gets new calls). */
const wrap = (node: ReactNode, developerMode = false) =>
  render(node, {
    wrapper: ({ children }) => (
      <I18nProvider i18n={i18n}>
        <CardActionsProvider value={{ runFix: () => FIXED, developerMode }}>{children}</CardActionsProvider>
      </I18nProvider>
    ),
  });

const call = (id: string, tool: string, status: CardOf<'toolRun'>['status'] = 'succeeded'): RunTool => ({
  card: { ...CARD_FIXTURES.toolRun.succeeded!, id, tool, status },
});
const shape = (tools: readonly RunTool[]) =>
  groupToolRuns(tools).map((entry) =>
    entry.kind === 'call' ? entry.key : { [entry.key]: entry.calls.map(({ card }) => card.id) },
  );

describe('grouping a run’s calls', () => {
  it('leaves a lone call as it is', () => {
    expect(groupToolRuns([call('a', 'library.getAsset')])).toEqual([
      { kind: 'call', key: 'a', call: call('a', 'library.getAsset') },
    ]);
  });

  it('folds eleven calls to one tool into one group, keyed by the first', () => {
    const entries = groupToolRuns(toolGroupFixture('running'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'group', key: 'group-running-0', tool: 'library.getAsset' });
    expect(entries[0]?.kind === 'group' && entries[0].calls).toHaveLength(11);
  });

  it('never groups two tools that take turns, so the order stays true', () => {
    const tools = [
      call('a', 'library.getAsset'),
      call('b', 'vision.describeFrame'),
      call('c', 'library.getAsset'),
      call('d', 'vision.describeFrame'),
    ];
    expect(shape(tools)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('groups each run of one tool on its own', () => {
    const tools = [
      call('a', 'library.getAsset'),
      call('b', 'library.getAsset'),
      call('c', 'vision.describeFrame'),
      call('d', 'vision.describeFrame'),
      call('e', 'vision.describeFrame'),
      call('f', 'library.getAsset'),
    ];
    expect(shape(tools)).toEqual([{ a: ['a', 'b'] }, { c: ['c', 'd', 'e'] }, 'f']);
  });

  it('counts how the group is going, and gives it one status', () => {
    expect(tallyToolRuns(toolGroupFixture('running'))).toEqual({
      total: 11,
      done: 4,
      failed: 0,
      running: 7,
      stopped: 0,
      status: 'running',
    });
    expect(tallyToolRuns(toolGroupFixture('done')).status).toBe('succeeded');
    expect(tallyToolRuns(toolGroupFixture('partlyFailed'))).toMatchObject({
      done: 9,
      failed: 2,
      status: 'failed',
    });
    const stopped = [call('a', 't'), call('b', 't', 'cancelled')];
    expect(tallyToolRuns(stopped).status).toBe('cancelled');
  });
});

describe('a group’s words', () => {
  it('names the calls in the plural, in the voice of their single name', () => {
    expect(toolGroupLabel(i18n, 'library.getAsset', 11)).toBe('Inspect 11 clips');
    expect(toolGroupLabel(i18n, 'vision.describeFrame', 3)).toBe('Look at 3 frames');
    expect(toolGroupLabel(i18n, 'timeline.captureFrame', 9)).toBe('Capture 9 frames');
    expect(toolGroupLabel(i18n, 'library.search', 1)).toBe('Search your clips');
    expect(toolGroupLabel(i18n, 'library.search', 3)).toBe('Search your clips, 3 times');
    expect(toolGroupLabel(i18n, 'templates.notATool', 2)).toBe('A step, 2 times');
  });

  it('has plural words only for tools that have a single name', () => {
    for (const tool of Object.keys(TOOL_GROUP_LABELS)) expect(TOOL_LABELS, tool).toHaveProperty([tool]);
  });

  it('says how many are done, all done, stopped, or how many failed', () => {
    const words = (tools: readonly RunTool[]) => toolGroupWords(i18n, tallyToolRuns(tools));
    expect(words(toolGroupFixture('running'))).toEqual(['4 of 11 done']);
    expect(words(toolGroupFixture('done'))).toEqual(['All 11 done']);
    expect(words(toolGroupFixture('partlyFailed'))).toEqual(['9 of 11 done', '2 failed']);
    expect(words([call('a', 't'), call('b', 't', 'cancelled')])).toEqual(['Stopped', '1 of 2 done']);
  });
});

/** The running fixture's calls, settled as the partly failed one: same ids, so the block keeps its rows. */
function settled(): RunTool[] {
  const after = toolGroupFixture('partlyFailed');
  return toolGroupFixture('running').map(({ card }, index) => ({
    card: { ...after[index]!.card, id: card.id },
  }));
}

const activity = () => document.querySelector<HTMLElement>('[data-slot=run-activity-toggle]')!;
const region = () => document.getElementById(activity().getAttribute('aria-controls')!)!;
const said = (container: HTMLElement) =>
  container.querySelector('[data-slot=run-announcement]')?.textContent ?? '';

describe('one activity disclosure for the run', () => {
  it('keeps successful calls collapsed and failed calls with their fixes outside', () => {
    wrap(<RunBlock tools={toolGroupFixture('partlyFailed')} />);
    expect(document.querySelectorAll('[data-slot=run-activity-toggle]')).toHaveLength(1);
    expect(activity().tagName).toBe('BUTTON');
    expect(activity().getAttribute('aria-expanded')).toBe('false');
    expect(region().getAttribute('aria-hidden')).toBe('true');
    expect(region().hasAttribute('inert')).toBe(true);
    expect(region().querySelectorAll('[data-slot=tool-run]')).toHaveLength(0);
    expect(region().querySelectorAll('[data-slot=tool-summary]')).toHaveLength(9);
    const failed = [...document.querySelectorAll('[data-slot=tool-run][data-status=failed]')];
    expect(failed).toHaveLength(2);
    for (const row of failed) {
      expect(region().contains(row)).toBe(false);
      expect(within(row as HTMLElement).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    }
  });

  it('reveals distinct outcomes once without per-call status rows or nested controls', () => {
    wrap(<RunBlock tools={toolGroupFixture('done')} />);
    fireEvent.click(activity());
    expect(activity().getAttribute('aria-expanded')).toBe('true');
    expect(region().getAttribute('data-state')).toBe('open');
    expect(region().hasAttribute('inert')).toBe(false);
    expect(within(region()).queryByText('IMG_0430.MOV · 0:27')).not.toBeNull();
    expect(region().querySelectorAll('[data-slot=tool-run]')).toHaveLength(0);
    expect(region().querySelectorAll('[data-slot=tool-group]')).toHaveLength(1);
    expect(region().querySelectorAll('[data-slot=tool-summary]')).toHaveLength(11);
    expect(region().querySelectorAll('details, button[aria-expanded]')).toHaveLength(0);
    fireEvent.click(activity());
    expect(activity().getAttribute('aria-expanded')).toBe('false');
  });

  it('uses the same collapsed activity for a lone successful call', () => {
    wrap(<RunBlock tools={[{ card: CARD_FIXTURES.toolRun.succeeded! }]} />);
    expect(activity().getAttribute('aria-expanded')).toBe('false');
    expect(region().querySelectorAll('[data-slot=tool-run]')).toHaveLength(0);
    expect(region().querySelectorAll('[data-slot=tool-group]')).toHaveLength(1);
    expect(region().querySelectorAll('details, button[aria-expanded]')).toHaveLength(0);
  });

  it('shows plan steps and their calls together after one disclosure', () => {
    const tools = toolGroupFixture('done', 'vision.describeFrame')
      .slice(0, 3)
      .map((tool) => ({ ...tool, stepId: 's2' }));
    wrap(<RunBlock plan={CARD_FIXTURES.plan.running!} tools={tools} />);
    fireEvent.click(activity());
    expect(region().querySelectorAll('[data-slot=tool-run]')).toHaveLength(0);
    expect(region().querySelectorAll('[data-slot=tool-group]')).toHaveLength(1);
    expect(region().querySelectorAll('details, button[aria-expanded]')).toHaveLength(0);
  });

  it('shows every failed call and retry without requiring a disclosure', () => {
    const tools = toolGroupFixture('done')
      .slice(0, 3)
      .map(({ card }) => ({
        card: { ...card, status: 'failed' as const, error: CARD_FIXTURES.toolRun.failed!.error! },
      }));
    wrap(<RunBlock tools={tools} />);
    const failed = document.querySelectorAll('[data-slot=tool-run][data-status=failed]');
    expect(failed).toHaveLength(3);
    for (const row of failed) expect(row.closest('[data-slot=run-activity]')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(3);
  });

  it('announces a live completion once and stays quiet when opened from history', () => {
    const { container, rerender } = wrap(<RunBlock tools={toolGroupFixture('running')} />);
    expect(said(container)).toBe('');
    rerender(<RunBlock tools={settled()} />);
    expect(said(container).length).toBeGreaterThan(0);
    const announcement = said(container);
    rerender(<RunBlock tools={settled()} />);
    expect(said(container)).toBe(announcement);
    const history = wrap(<RunBlock tools={toolGroupFixture('partlyFailed')} />);
    expect(said(history.container)).toBe('');
  });
});

describe('compact operations inside activity', () => {
  const captures = Array.from({ length: 9 }, (_, index) => ({
    card: {
      ...call(`capture-${index}`, 'timeline.captureFrame').card,
      summary: `Airport sequence · frame ${index + 1}`,
      artifactIds: [`captured-frame-${index}`],
    },
  }));
  const looks = Array.from({ length: 3 }, (_, index) => ({
    card: {
      ...call(`look-${index}`, 'vision.describeFrame', 'running').card,
      summary: '',
      artifactIds: [],
    },
  }));
  const list = (tools: RunTool[]) => <ToolRunList tools={tools} arrives={() => false} />;

  it('shows nine captures and three running inspections as two operation rows', () => {
    const { container } = wrap(list([...captures, ...looks]));
    expect(screen.getByText('Capture 9 frames')).toBeTruthy();
    expect(screen.getByText('Look at 3 frames')).toBeTruthy();
    expect(container.querySelectorAll('[data-slot=tool-group]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot=tool-run], [data-slot=tool-summary]')).toHaveLength(0);
    expect(screen.queryByText('Capture a video frame')).toBeNull();
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText('All 9 done')).toBeNull();
    expect(screen.queryByText('Airport sequence · frame 1')).toBeNull();
    expect(screen.getByText('9 results saved')).toBeTruthy();
  });

  it('preserves useful output once and counts saved results without duplicating shared ids', () => {
    const tools = captures.slice(0, 3).map(({ card }, index) => ({
      card: {
        ...card,
        tool: 'vision.describeFrame',
        summary: index === 2 ? 'The closing shot is underexposed.' : 'A pink reflection is visible.',
        artifactIds: ['same-frame', `frame-${index}`],
      },
    }));
    const { container } = wrap(list(tools));
    expect(screen.getAllByText('A pink reflection is visible.')).toHaveLength(1);
    expect(screen.getByText('The closing shot is underexposed.')).toBeTruthy();
    expect(screen.getByText('4 results saved')).toBeTruthy();
    expect(container.querySelectorAll('[data-slot=tool-summary]')).toHaveLength(2);
  });

  it('keeps process exit metadata out of normal outcomes', () => {
    wrap(list([{ card: { ...call('cmd', 'workspace.exec').card, summary: 'exit 0', artifactIds: [] } }]));
    expect(screen.queryByText('exit 0')).toBeNull();
  });

  it('keeps developer mode compact until its diagnostics are explicitly opened', () => {
    const { container } = wrap(list(captures), true);
    const toggle = screen.getByRole('button', { name: 'Tool diagnostics' });
    const diagnostics = container.querySelector('[data-slot=tool-diagnostics]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(diagnostics.getAttribute('aria-hidden')).toBe('true');
    expect(diagnostics.hasAttribute('inert')).toBe(true);
    expect(diagnostics.querySelectorAll('[data-slot=tool-run]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-slot=tool-summary]')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(diagnostics.hasAttribute('inert')).toBe(false);
    expect(screen.getByText('Airport sequence · frame 1')).toBeTruthy();
    expect(screen.getAllByText('timeline.captureFrame')).toHaveLength(9);
    fireEvent.click(toggle);
    expect(diagnostics.getAttribute('aria-hidden')).toBe('true');
  });

  it('retains an active generated image preview and actionable failed call', () => {
    const image = { card: { ...CARD_FIXTURES.toolRun.running!, tool: 'images.generateThumbnail' } };
    const failed = { card: CARD_FIXTURES.toolRun.failed! };
    const { container } = wrap(list([image, failed]));
    expect(container.querySelector('[data-slot=image-generation][data-status=generating]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
