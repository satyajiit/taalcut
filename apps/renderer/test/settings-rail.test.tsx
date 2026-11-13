// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 fix-up: Settings' sidebar folded to its rail drops the group headings' room and puts a hairline between the
// groups. The sections read the fold from inside the folding panel; read from above it, the rail was never seen
// and the headings kept their room (e2e/settings.spec.ts measures the rail at 1024 × 720 and 960 × 600).
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setSidebarCollapsed } from '../src/shell/sidebar-state';
import { renderApp } from './render-app';

const sections = () => screen.findByRole('navigation', { name: 'Settings' });
const headingBoxes = (nav: HTMLElement) =>
  [...nav.querySelectorAll('h2')].map((heading) => heading.closest('[data-slot=fold-fade]'));

describe('Settings › the sidebar’s rail', () => {
  it('on the rail the group headings take no room and a hairline stands between the groups', async () => {
    setSidebarCollapsed(true);
    await renderApp('/settings/about');
    const nav = await sections();
    expect(document.querySelector('[data-slot=sidebar]')?.hasAttribute('data-rail')).toBe(true);
    const boxes = headingBoxes(nav);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box?.classList.contains('hidden')).toBe(true);
    // UX4 set: four groups (General leads untitled), so three hairlines between them.
    expect(nav.querySelectorAll('[data-group-rule]')).toHaveLength(3);
    // Every section is still a link, named for screen readers.
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
    // About is one of General's views: General's row stays current on it.
    expect(within(nav).getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
  });

  it('open, the headings name the groups and there are no hairlines', async () => {
    setSidebarCollapsed(false);
    await renderApp('/settings/about');
    const nav = await sections();
    for (const box of headingBoxes(nav)) expect(box?.classList.contains('hidden')).toBe(false);
    expect(
      within(nav)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Your work', 'AI and privacy', 'Connections']);
    expect(nav.querySelectorAll('[data-group-rule]')).toHaveLength(0);
  });
});
