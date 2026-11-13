// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT in the real app (make-flow.e2e.ts): three comments on the brief's video, on different items (clip 1 from C,
 * clip 2 from its right-click menu, a line of text from its menu), sent together from the dock's Comments, and each
 * answered by the Editor on the make flow's recorded model session (gate-demo make-flow-comments.ts).
 */
import { DatabaseSync } from 'node:sqlite';
import { expect, type Page } from '@playwright/test';
import { COMMENTED_TEXT } from '@taalcut/gate-demo';
import { openComments, showDetailedTimeline } from './editor-navigation';
import { libraryPath } from '../src/shared/library-path';

interface CommentRow {
  readonly status: string;
  readonly reply: string | null;
  readonly author: string;
}

function read<T>(userData: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** The video the newest export was made from. */
export function exportedTimeline(userData: string): { projectId: string; timelineId: string } {
  const [row] = read<{ project_id: string; timeline_id: string }>(
    userData,
    `SELECT project_id, timeline_id FROM renders WHERE status = 'ready' ORDER BY created_at DESC LIMIT 1`,
  );
  if (!row) throw new Error('no export to comment on');
  return { projectId: row.project_id, timelineId: row.timeline_id };
}

export const commentsOn = (userData: string, timelineId: string): CommentRow[] =>
  read<CommentRow>(
    userData,
    'SELECT status, reply, author FROM timeline_comments WHERE timeline_id = ? ORDER BY created_at',
    timelineId,
  );

const composer = (page: Page) => page.locator('[data-slot=comment-composer]');

async function write(page: Page, title: string, words: string): Promise<void> {
  await expect(composer(page).getByRole('heading', { name: title })).toBeVisible();
  await composer(page).getByRole('textbox', { name: 'Your comment' }).fill(words);
  await composer(page).getByRole('button', { name: 'Add comment' }).click();
  await expect(composer(page)).toHaveCount(0);
}

/** Opens the video in the editor and leaves the three comments; returns when each waits as open. */
export async function leaveThreeComments(page: Page, at: { projectId: string; timelineId: string }) {
  await page.goto(`app://taalcut/projects/${at.projectId}/timeline?timeline=${at.timelineId}`);
  await showDetailedTimeline(page);
  const clips = page.locator('[data-slot=video-track]').getByRole('option');
  await expect(clips.first()).toBeVisible({ timeout: 30_000 });
  await clips.nth(0).click();
  await page.keyboard.press('c');
  await write(page, 'Comment on Clip 1', 'Open on the wide shot of the sea');
  await clips.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment…' }).click();
  await write(page, 'Comment on Clip 2', 'Hold this one a beat longer');
  const text = page.locator('[data-slot=timeline-text]').first();
  await text.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Comment…' }).click();
  await expect(composer(page).getByRole('heading', { name: /^Comment on Text 1/ })).toBeVisible();
  await composer(page).getByRole('textbox', { name: 'Your comment' }).fill('Say golden hour at the market');
  await composer(page).getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('[data-slot=comment-pins] button[data-status=open]')).toHaveCount(3);
}

/** Sends them from the dock's Comments; returns when the run is done and each comment is done with its reply. */
export async function sendComments(page: Page, timeout: number) {
  await openComments(page);
  const panel = page.locator('[data-slot=comments-panel]');
  await panel.getByRole('button', { name: 'Send 3 comments to Taalcut' }).click();
  const dock = page.locator('[data-slot=editor-dock]');
  await expect(dock.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  // The run's one step, the Editor working through them. The run block folds a plan once nothing in it is working
  // (run-block.tsx, `details open={active}`), and on the recorded session the batch can finish before the first look:
  // the step is in the plan, shown or folded.
  const plan = dock
    .locator('[data-slot=run-block][data-card-type=plan]')
    .filter({ hasText: 'Work through your comments' });
  await expect(plan.first()).toBeAttached({ timeout });
  await openComments(page);
  const done = panel.getByRole('region', { name: 'Done' }).locator('[data-slot=comment-row]');
  await expect(done).toHaveCount(3, { timeout });
  for (const row of await done.all()) await expect(row.locator('[data-slot=comment-reply]')).not.toBeEmpty();
  await expect(page.locator('[data-slot=timeline-text]').first()).toContainText(COMMENTED_TEXT);
}
