// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The GitHub pages (Star, Report issue, Feature request) open in the person's browser through main
// (`files.openExternal`): from Settings › About's links, and from the Help menu and ⌘K's Help items. A window can't
// open a new window (desktop refuses every one), so a plain `target=_blank` link did nothing in the app. Since UX1 the
// window bar holds Back, Forward and the page's title, and no GitHub links.
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GITHUB_FEATURE_URL, GITHUB_ISSUE_URL, GITHUB_REPO_URL } from '../src/shell/github-links';
import {
  expectOpenedThroughMain,
  OPEN_EXTERNAL as OPEN,
  renderWatched,
  type Watch,
} from './settings/spied-backend';

const PAGES = [
  { name: 'Star on GitHub', url: GITHUB_REPO_URL },
  { name: 'Report issue', url: GITHUB_ISSUE_URL },
  { name: 'Feature request', url: GITHUB_FEATURE_URL },
] as const;

/** Clicks each link in `scope` in turn: main is asked for its page, and the browser's own navigation is cancelled. */
async function clickEach(scope: HTMLElement, callsTo: (watch: Watch) => unknown[]) {
  const asked: { url: string }[] = [];
  for (const { name, url } of PAGES) {
    asked.push({ url });
    await expectOpenedThroughMain(within(scope).getByRole('link', { name }), url, asked, callsTo);
  }
}

describe('GitHub links open in the browser through main', () => {
  it('the window bar has none: Back, Forward and the title', async () => {
    await renderWatched('/chat', OPEN);
    await screen.findByRole('group', { name: 'History' });
    expect(screen.queryByRole('link', { name: 'Star on GitHub' })).toBeNull();
    const actions = document.querySelector('[data-slot="window-bar-actions"]');
    expect(actions?.querySelectorAll('a[href^="https://github.com"]') ?? []).toHaveLength(0);
  });

  it("the Help menu's items: the page opens the same three pages", async () => {
    const { callsTo, controls } = await renderWatched('/chat', OPEN);
    const actions = ['help.github', 'help.reportIssue', 'help.requestFeature'];
    // The palette's chunk carries the items the menu runs; it loads right after the first frame.
    await waitFor(() => {
      controls.events.emit('ui.action', { action: 'help.github' });
      expect(callsTo(OPEN).length).toBeGreaterThan(0);
    });
    const before = callsTo(OPEN).length;
    await act(async () => {
      for (const action of actions.slice(1)) controls.events.emit('ui.action', { action });
    });
    await waitFor(() =>
      expect(callsTo(OPEN).slice(before)).toEqual([{ url: GITHUB_ISSUE_URL }, { url: GITHUB_FEATURE_URL }]),
    );
    expect(callsTo(OPEN)[0]).toEqual({ url: GITHUB_REPO_URL });
  });

  it('Settings › About: the same three pages', async () => {
    const { callsTo } = await renderWatched('/settings/about', OPEN);
    const links = await screen.findByText('Report issue', { selector: 'a *, a' }, { timeout: 3000 });
    const about = links.closest<HTMLElement>('[data-slot="github-about-links"]');
    expect(about).not.toBeNull();
    if (about) await clickEach(about, callsTo);
  });
});
