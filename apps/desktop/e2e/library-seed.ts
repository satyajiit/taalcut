// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The theme preference where the app keeps it (core's THEME_SETTING in the
 * library's settings table), for launch tests: seeded before the app opens
 * the library, read back while it runs (a read-only second connection). A
 * long conversation, for tests that time the shell over a long transcript.
 * And first run, finished or as the app left it (ONBOARDING_SETTING).
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  newId,
  ONBOARDING_SETTING,
  onboardingProgressSchema,
  THEME_SETTING,
  type ConversationId,
  type OnboardingProgress,
  type RunId,
  type ThemePreference,
} from '@taalcut/core';
import { createLibraryPorts, openDatabase } from '@taalcut/library';
import { libraryPath } from '../src/shared/library-path';

export async function seedTheme(userData: string, preference: ThemePreference): Promise<void> {
  const opened = openDatabase({ path: libraryPath(userData) });
  if (!opened.ok) throw new Error(`library not opened: ${opened.error.code}`);
  try {
    const saved = await createLibraryPorts(opened.value).settings.set(THEME_SETTING, preference);
    if (!saved.ok) throw new Error(`theme not saved: ${saved.error.code}`);
  } finally {
    opened.value.close();
  }
}

/**
 * A finished conversation of `messages` turns (alternating you and the agent,
 * the agent's in a few paragraphs and a list), for tests that need a long
 * transcript on screen. Returns its id.
 */
export async function seedConversation(
  userData: string,
  title: string,
  messages: number,
): Promise<ConversationId> {
  const opened = openDatabase({ path: libraryPath(userData) });
  if (!opened.ok) throw new Error(`library not opened: ${opened.error.code}`);
  try {
    const store = createLibraryPorts(opened.value).conversations;
    const created = await store.create({ title });
    if (!created.ok) throw new Error(`conversation not created: ${created.error.code}`);
    let runId: RunId = newId<'AgentRun'>();
    for (let i = 0; i < messages; i += 1) {
      const you = i % 2 === 0;
      // Each of your messages starts a run; the agent's answer is that run's.
      if (you) runId = newId<'AgentRun'>();
      const text = you
        ? `Cut ${i + 1}: keep the shots where the light is warm and trim the pauses between lines.`
        : [
            `Here is take ${i + 1}. I kept the warm shots and cut the pauses, so the reel lands on the beat.`,
            'What changed:\n\n- the opening shot is two beats shorter\n- the middle holds on the laugh\n- the last cut lands on the downbeat',
            'Tell me if the pace feels right, or if the middle should breathe a little more.',
          ].join('\n\n');
      const appended = await store.appendMessage({
        conversationId: created.value.id,
        role: you ? 'user' : 'assistant',
        parts: [{ type: 'text', text }],
        runId,
      });
      if (!appended.ok) throw new Error(`message not appended: ${appended.error.code}`);
    }
    return created.value.id;
  } finally {
    opened.value.close();
  }
}

export function savedTheme(userData: string): unknown {
  return storedSetting(userData, THEME_SETTING.key);
}

/** First run as the app keeps it; undefined while nothing is stored (no library yet, or first run not begun). */
export function savedOnboarding(userData: string): OnboardingProgress | undefined {
  if (!existsSync(libraryPath(userData))) return undefined;
  const stored = storedSetting(userData, ONBOARDING_SETTING.key);
  return stored === undefined ? undefined : onboardingProgressSchema.parse(stored);
}

/**
 * First run finished, the way onboarding leaves it when you skip or finish:
 * the app opens on the chat, as it did before first run existed. A library
 * where it is already done is only read, so a relaunch after a kill finds the
 * database as the killed app left it; a write opens it without reclaiming jobs.
 */
export async function seedFirstRunDone(userData: string): Promise<void> {
  if (savedOnboarding(userData)?.completedAt != null) return;
  const opened = openDatabase({ path: libraryPath(userData), recovery: { reclaimJobs: 'none' } });
  if (!opened.ok) throw new Error(`library not opened: ${opened.error.code}`);
  try {
    const now = Date.now();
    const saved = await createLibraryPorts(opened.value).settings.set(ONBOARDING_SETTING, {
      step: 'first-video',
      startedAt: now,
      completedAt: now,
      branch: {},
      completedVia: 'finished',
    });
    if (!saved.ok) throw new Error(`first run not marked done: ${saved.error.code}`);
  } finally {
    opened.value.close();
  }
}

/** A setting's stored value, read over a read-only second connection. */
function storedSetting(userData: string, key: string): unknown {
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  } finally {
    db.close();
  }
}
