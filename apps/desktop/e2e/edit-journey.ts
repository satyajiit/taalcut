// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the editor's journey in the real app, after a make flow made a video: open its editor, select the first
 * clip, ask the docked chat "make this half speed and add a crossfade into the next one", and the timeline shows
 * both (in the bed and in the stored document). The stand-in Editor answers it (apps/gate-demo make-flow-edit.ts).
 */
import { DatabaseSync } from 'node:sqlite';
import { expect, type Page } from '@playwright/test';
import { EDIT_JOURNEY_ASK } from '@taalcut/gate-demo';
import { showDetailedTimeline } from './editor-navigation';
import { libraryPath } from '../src/shared/library-path';

interface StoredClip {
  readonly type: string;
  readonly id: string;
  readonly kind?: string;
  readonly speed?: { readonly points: readonly { readonly speed: number }[] } | null;
}

function read<T>(userData: string, sql: string): T[] {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

/** The newest timeline: its project and its first track's items. */
function newestTimeline(userData: string) {
  const [row] = read<{ id: string; project_id: string; document: string }>(
    userData,
    'SELECT id, project_id, document FROM timelines ORDER BY updated_at DESC LIMIT 1',
  );
  if (!row) throw new Error('No timeline yet');
  const document = JSON.parse(row.document) as { tracks: { items: StoredClip[] }[] };
  return { id: row.id, projectId: row.project_id, items: document.tracks[0]?.items ?? [] };
}

export async function editJourney(page: Page, userData: string, timeoutMs: number) {
  const made = newestTimeline(userData);
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/projects/${made.projectId}/timeline?timeline=${made.id}`);
  await showDetailedTimeline(page);
  const clips = page.locator('[data-slot=timeline-clip]');
  await expect(clips.first()).toBeVisible({ timeout: 30_000 });
  await clips.first().click();
  const dock = page.locator('[data-slot=editor-dock]');
  await expect(dock.locator('[data-slot=composer] [data-slot=selection-chip]')).toContainText('Clip 1');
  const box = dock.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(EDIT_JOURNEY_ASK);
  await box.press('Enter');
  // This ask's changes card: the comments journey before this one left its own (the opening title's) in the dock.
  await expect(dock.locator('[data-card-type=editChanges]').filter({ hasText: 'Clip 1:' })).toBeVisible({
    timeout: timeoutMs,
  });

  const first = made.items.find((item) => item.type === 'clip')!;
  await expect
    .poll(() => {
      const items = newestTimeline(userData).items;
      const index = items.findIndex((item) => item.id === first.id);
      return {
        halfSpeed: items[index]?.speed?.points.every((point) => point.speed === 0.5) ?? false,
        crossfade: items[index + 1]?.type === 'transition' && items[index + 1]?.kind === 'dissolve',
      };
    })
    .toEqual({ halfSpeed: true, crossfade: true });
  // The bed draws the crossfade where the first clip meets the next.
  await expect(page.locator('[data-slot=timeline-transition]').first()).toBeVisible();
}
