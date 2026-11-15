// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: `templates.get` names a template's text that replaces itself in place: each piece says which sequence it is
 * in, the sequences are named in a sentence each, and a doubted speech is said to be doubted. A template without
 * such text reads as before.
 */
import { newId, TEMPLATE_COMMANDS, type Template } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { at, referenceTemplate } from './helpers/fixtures';
import { UI } from './helpers/setup';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

/** Five texts in turn at one place across the template's first cut (frame 30), then a title on its own. */
const TURNS: readonly (readonly [string, number, number])[] = [
  ['I hope', 4, 22],
  ['You', 22, 30],
  ['Leave', 30, 44],
  ['And', 44, 55],
  ["Don't", 55, 70],
];

function lyricTemplate(doubtSpeech: boolean): Template {
  const base = referenceTemplate();
  const title = base.text[1]!;
  const turns = TURNS.map(([text, start, end]) => ({
    ...base.text[0]!,
    id: newId<'TextOverlay'>(),
    text,
    role: 'label' as const,
    start: at(start),
    duration: at(end - start),
    slotId: base.slots[start < 30 ? 0 : start < 45 ? 1 : 2]!.id,
    box: { x: 0.5 - 0.03 * text.length, y: 0.47, width: 0.06 * text.length, height: 0.045 },
    styleKey: 'label',
    reveal: 'none' as const,
  }));
  return {
    ...base,
    text: [...turns, title],
    ...(doubtSpeech ? { doubts: [{ reason: 'speechMaybeHallucinated' as const }] } : {}),
  };
}

interface Got {
  overlays: { text: string; sequence?: number }[];
  sequences?: string[];
  speechDoubted?: boolean;
}

async function got(template: Template): Promise<{ output: Got; summary: string }> {
  setup = setupTools();
  const made = await setup.bus.dispatch(
    TEMPLATE_COMMANDS.create,
    { projectId: setup.projectA, template, name: 'Lyric', listed: true },
    UI,
  );
  if (!made.ok) throw new Error(`${made.error.code} ${made.error.detail ?? ''}`);
  const output = await setup.value<Got>('templates.get', { templateId: template.id });
  const tool = setup.tool('templates.get');
  return { output, summary: tool.summarize?.(output as never) ?? '' };
}

describe('templates.get on text that replaces itself in place (LYR1)', () => {
  it('says which overlays are one sequence, names it, and says when the speech is doubted', async () => {
    const { output, summary } = await got(lyricTemplate(true));
    expect(output.overlays.map((overlay) => [overlay.text, overlay.sequence])).toEqual([
      ['I hope', 1],
      ['You', 1],
      ['Leave', 1],
      ['And', 1],
      ["Don't", 1],
      ['Follow for more', undefined],
    ]);
    expect(output.sequences).toEqual(['a 5-text sequence, one at a time, 0.13–2.33 s (about 0.4 s each)']);
    expect(output.speechDoubted).toBe(true);
    expect(summary).toMatch(
      / Its text has a 5-text sequence, one at a time, 0\.13–2\.33 s \(about 0\.4 s each\)\.$/,
    );
  });

  it('reads a template without one as before', async () => {
    const { output, summary } = await got(referenceTemplate());
    expect(output.sequences).toBeUndefined();
    expect(output.speechDoubted).toBeUndefined();
    expect(output.overlays.every((overlay) => overlay.sequence === undefined)).toBe(true);
    expect(summary).not.toContain('Its text has');
  });
});
