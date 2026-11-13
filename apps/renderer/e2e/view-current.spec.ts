// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// One current place per row (UX4 gate, T1). A row of views or a rail of places says which one is open, once: the
// router marks a link current on any page under it too, so a view's own `current` is the only word, and the first
// view (the parent path) never claims a sibling's page.
import { expect, test } from '@playwright/test';
import { TEMPLATE } from './routes.ts';
import { open, preferences } from './support.ts';

const PLACES = [
  { name: 'templates-start-formats', path: '/templates/start/formats', current: ['Start from…', 'Formats'] },
  { name: 'templates-template-slots', path: `/templates/${TEMPLATE}/slots`, current: ['Slots'] },
  {
    name: 'templates-folder',
    path: '/templates/folders/favourites',
    current: ['Your templates', 'Favourites'],
  },
  { name: 'templates-saved-collection', path: '/templates/saved/col_inspo', current: ['Saved on Instagram'] },
  { name: 'projects-archived', path: '/projects?archived=true', current: ['Archived'] },
  { name: 'projects-style', path: '/projects/style', current: ['Your style'] },
  { name: 'settings-usage-breakdown', path: '/settings/usage/breakdown', current: ['Breakdown'] },
  { name: 'settings-accounts-keys', path: '/settings/accounts/keys', current: ['Keys'] },
] as const;

for (const place of PLACES) {
  test(`${place.path}: each row has one current place`, async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, place);
    const rows = page.locator('main [data-view-links]');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row.locator('[aria-current=page]')).toHaveCount(1);
    const current = page.locator('main [data-view-links] [aria-current=page]');
    for (const name of place.current) await expect(current.filter({ hasText: name })).toHaveCount(1);
  });
}
