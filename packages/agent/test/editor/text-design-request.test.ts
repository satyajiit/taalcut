// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the words "Design text with AI" sends from a selected text's inspector (the renderer's
 * text-design-action.tsx, which cannot import the agent) go to the Editor: they ask for a change to this video,
 * carry none of the phrases that ask for a new one, and are no question.
 */
import { editorRoute, MAKE_WORDS } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

const WORDS =
  "Design the text of this video: give every text a designed look based on the reference's look, and put each " +
  'text where it should sit.';

describe('the text design request (TXT1)', () => {
  it('is an edit of this video', () => {
    expect(editorRoute(WORDS)).toBe('edit');
    const lower = WORDS.toLowerCase();
    expect(MAKE_WORDS.filter((phrase) => lower.includes(phrase))).toEqual([]);
  });
});
