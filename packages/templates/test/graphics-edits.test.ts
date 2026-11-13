// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1's `template.setGraphics`: a new version with the compositions and the overlays they draw; undo puts the
 * version before back; null removes them; a use of an overlay the template lacks is dropped. Made-up design.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  TEMPLATE_COMMANDS as N,
  templateSchema,
  type GraphicComposition,
  type Template,
} from '@taalcut/core';
import { json, referenceTemplate } from './helpers/fixtures';
import { setupTemplates, UI } from './helpers/setup';

const sha = (c: string) => c.repeat(64);
const composition = (): GraphicComposition => ({
  id: newId<'GraphicComposition'>(),
  version: 1,
  hash: sha('c'),
  name: 'Made-up message',
  entry: 'message/index.html',
  files: [{ path: 'message/index.html', sha256: sha('a'), bytes: 100 }],
  variables: [{ type: 'text', name: 'message', maxLength: 80, sample: 'Made-up words' }],
  durationSeconds: 3,
  provenance: { model: null, overlays: [], brief: null, createdAt: 0 },
  gate: {
    version: 'hfw1.1',
    passed: true,
    checkedAt: 0,
    hfLint: { errors: 0, warnings: 0 },
    checks: [],
    loweredTweens: 1,
  },
});

describe('template.setGraphics', () => {
  it('makes a new version with the compositions and their uses, and undo puts it back', async () => {
    const setup = setupTemplates();
    const template: Template = referenceTemplate();
    await setup.bus.dispatch(
      N.create,
      { projectId: setup.projectA, template, name: 'Goa', listed: true },
      UI,
    );
    const head = async () => {
      const got = await setup.service.get({ templateId: template.id });
      if (!got.ok) throw new Error(got.error.code);
      expect(templateSchema.safeParse(json(got.value.template)).success).toBe(true);
      return got.value.template;
    };
    const made = composition();
    const overlay = template.text[0]!.id;
    const gone = newId<'TextOverlay'>();
    const run = (graphics: object | null, baseVersion: number) =>
      setup.bus.dispatch(
        N.setGraphics,
        { projectId: setup.projectA, templateId: template.id, baseVersion, graphics },
        UI,
      );
    const set = await run(
      {
        compositions: [made],
        uses: [
          { overlayId: overlay, compositionId: made.id, params: { side: 'left' } },
          { overlayId: gone, compositionId: made.id },
        ],
      },
      1,
    );
    expect(set.ok).toBe(true);
    const after = await head();
    expect(after.version).toBe(2);
    expect(after.graphics?.compositions?.map((entry) => entry.id)).toEqual([made.id]);
    expect(after.graphics?.uses).toEqual([
      { overlayId: overlay, compositionId: made.id, params: { side: 'left' } },
    ]);
    await setup.bus.undo(setup.projectA, UI);
    expect((await head()).graphics).toBeUndefined();
    await setup.bus.redo(setup.projectA, UI);
    expect((await run(null, 2)).ok).toBe(true);
    expect((await head()).graphics).toBeUndefined();
  });
});
