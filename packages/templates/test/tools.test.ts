// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates tools the Librarian and the breakdown card use (P2-T7,
 * P2-T8): a format plan saved unlisted, list and get, and the slot edits as
 * commands with the agent as author. Also: every schema converts to JSON
 * Schema for the model, as the executor needs.
 */
import { FORMAT_IDS } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

interface SlotLine {
  id: string;
  intent: string;
  intentSource: string;
  shotType: string;
  motion: string;
  energy: number;
  needs: string[];
  face: boolean;
  reel: string | null;
  approved: boolean;
}

async function plan(s: ToolSetup) {
  return s.value<{ templateId: string; version: number; slotCount: number }>('templates.planFromFormat', {
    projectId: s.projectA,
    formatId: 'vlog',
    targetSeconds: 30,
    brief: 'a weekend in Lisbon',
  });
}

describe('templates tools', () => {
  it('have input and output schemas the model can read', () => {
    setup = setupTools();
    for (const tool of setup.module.tools) {
      for (const io of ['input', 'output'] as const) {
        const schema = io === 'input' ? tool.input : tool.output;
        expect(
          () => z.toJSONSchema(schema, { io, unrepresentable: 'throw' }),
          `${tool.name} ${io}`,
        ).not.toThrow();
      }
    }
  });

  it('plans from a format, unlisted, once per idempotency key', async () => {
    setup = setupTools();
    const planned = await plan(setup);
    expect(planned.version).toBe(1);
    expect(planned.slotCount).toBeGreaterThan(3);
    const again = await plan(setup);
    expect(again.templateId).toBe(planned.templateId);

    const listed = await setup.value<{ items: { id: string }[] }>('templates.list', {});
    expect(listed.items).toEqual([]);
    const all = await setup.value<{ items: { id: string; listed: boolean; origin: string }[] }>(
      'templates.list',
      {
        includeUnlisted: true,
      },
    );
    expect(all.items).toEqual([
      expect.objectContaining({ id: planned.templateId, listed: false, origin: 'format' }),
    ]);
  });

  // Review H1: the brief may hand off any of core's eight formats, and the Librarian plans with this tool.
  it.each(FORMAT_IDS)('plans a %s brief at 15, 30, 60 and 120 seconds', async (formatId) => {
    setup = setupTools();
    for (const targetSeconds of [15, 30, 60, 120]) {
      const planned = await setup.value<{ templateId: string; slotCount: number }>(
        'templates.planFromFormat',
        {
          projectId: setup.projectA,
          formatId,
          targetSeconds,
          brief: `a ${targetSeconds} s ${formatId}`,
        },
      );
      expect(planned.slotCount, `${formatId} at ${targetSeconds} s`).toBeGreaterThan(0);
    }
  });

  it('refuses a target outside 6 to 120 seconds', async () => {
    setup = setupTools();
    const result = await setup.call('templates.planFromFormat', {
      projectId: setup.projectA,
      formatId: 'dayInTheLife',
      targetSeconds: 150,
    });
    expect(!result.ok && result.error.code).toBe('core.validation');
  });

  it('reads a template as slot lines with the document as an artifact', async () => {
    setup = setupTools();
    const planned = await plan(setup);
    const got = await setup.value<{ version: number; slots: SlotLine[]; document?: { id: string } }>(
      'templates.get',
      { templateId: planned.templateId },
    );
    expect(got.version).toBe(1);
    expect(got.slots).toHaveLength(planned.slotCount);
    expect(got.document && setup.artifacts.items.has(got.document.id as never)).toBe(true);
  });

  it('edits slots through their commands, the agent writing as the analyst', async () => {
    setup = setupTools();
    const planned = await plan(setup);
    const read = await setup.value<{ slots: SlotLine[] }>('templates.get', {
      templateId: planned.templateId,
    });
    const [first, second] = read.slots;
    const where = { projectId: setup.projectA, templateId: planned.templateId };

    const edited = await setup.value<{ version: number }>('templates.editIntent', {
      ...where,
      baseVersion: 1,
      slotId: second!.id,
      intent: { text: 'tram rattling past, handheld', motion: 'handheld' },
    });
    expect(edited.version).toBe(2);
    const renamed = await setup.value<{ version: number }>('templates.renameSlot', {
      ...where,
      baseVersion: 2,
      slotId: first!.id,
      name: 'Opener',
    });
    expect(renamed.version).toBe(3);
    const approved = await setup.value<{ version: number }>('templates.approveSlots', {
      ...where,
      baseVersion: 3,
      slotIds: [second!.id],
    });
    expect(approved.version).toBe(4);

    const blocked = await setup.call('templates.editIntent', {
      ...where,
      baseVersion: 4,
      slotId: second!.id,
      intent: { text: 'something else' },
    });
    expect(!blocked.ok && blocked.error.code).toBe('templates.slot_approved');

    const stale = await setup.call('templates.renameSlot', {
      ...where,
      baseVersion: 1,
      slotId: first!.id,
      name: 'Old',
    });
    expect(!stale.ok && stale.error.code).toBe('core.conflict');

    const after = await setup.value<{ slots: SlotLine[]; overlays: unknown[] }>('templates.get', {
      templateId: planned.templateId,
    });
    expect(after.slots[1]).toMatchObject({
      intent: 'tram rattling past, handheld',
      intentSource: 'analyst',
      motion: 'handheld',
      approved: true,
    });
    expect(Array.isArray(after.overlays)).toBe(true);

    const merged = await setup.value<{ version: number }>('templates.mergeSlots', {
      ...where,
      baseVersion: 4,
      slotIds: [after.slots[2]!.id, after.slots[3]!.id],
    });
    const dropped = await setup.value<{ version: number; templateId: string }>('templates.dropSlot', {
      ...where,
      baseVersion: merged.version,
      slotId: after.slots[0]!.id,
    });
    expect(dropped.version).toBe(6);
    const final = await setup.value<{ slots: SlotLine[] }>('templates.get', {
      templateId: planned.templateId,
    });
    expect(final.slots).toHaveLength(planned.slotCount - 2);
  });
});
