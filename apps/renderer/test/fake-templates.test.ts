// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, templateSchema, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import {
  buildTemplate,
  GOLDEN_HOUR,
  TEMPLATE_PLANS,
  templateIdOf,
} from '../src/backend/fake/templates/template-data';
import { approveSlots, dropSlot, mergeSlots, renameSlot } from '../src/backend/fake/templates/template-edits';

const valid = (template: Template) => {
  const parsed = templateSchema.safeParse(template);
  if (!parsed.success)
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  return true;
};

describe('fake templates', () => {
  it('are Template v1 documents that keep their invariants', () => {
    for (const plan of TEMPLATE_PLANS) expect(valid(buildTemplate(plan))).toBe(true);
    const golden = buildTemplate(GOLDEN_HOUR);
    expect(golden.slots).toHaveLength(12);
    expect(golden.beatMap?.bpm).toBe(120);
  });

  it('every slot edit makes a version that still parses', () => {
    const t = buildTemplate(GOLDEN_HOUR);
    const [a, b, c] = t.slots;
    for (const result of [
      renameSlot(t, a!.id, 'Chai hook', 1),
      approveSlots(t, [b!.id, c!.id], true, 1),
      mergeSlots(t, [b!.id, c!.id], undefined, 1),
      dropSlot(t, a!.id, 1),
      dropSlot(t, c!.id, 1),
    ]) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(valid(result.template)).toBe(true);
    }
    const merged = mergeSlots(t, [b!.id, c!.id], undefined, 1);
    if (merged.ok) {
      expect(merged.template.slots).toHaveLength(11);
      expect(merged.template.slots[1]!.duration.value).toBe(b!.duration.value + c!.duration.value);
    }
    expect(mergeSlots(t, [a!.id, c!.id], undefined, 1).ok).toBe(false);
  });

  it('slot commands make new versions on the bus, and undo and redo move the head', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const templateId = templateIdOf(GOLDEN_HOUR);
    const before = await client.templates.get({ templateId });
    expect(before.summary.head).toBe(2);
    const slot = before.template.slots[3]!;
    const renamed = await callRpc(
      client.commands.dispatch({
        name: 'template.slot.rename',
        payload: { projectId: null, templateId, baseVersion: 2, slotId: slot.id, name: 'Laugh' },
        source: 'ui',
      }),
    );
    expect(renamed.ok).toBe(true);
    const after = await client.templates.get({ templateId });
    expect(after.summary.head).toBe(3);
    expect(after.template.slots[3]!.name).toBe('Laugh');

    // A stale base version is a conflict, not a silent overwrite.
    const stale = await callRpc(
      client.commands.dispatch({
        name: 'template.slot.drop',
        payload: { projectId: null, templateId, baseVersion: 2, slotId: slot.id },
        source: 'ui',
      }),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('core.conflict');

    await client.commands.undo({ projectId: null, source: 'ui' });
    expect((await client.templates.get({ templateId })).summary.head).toBe(2);
    await client.commands.redo({ projectId: null, source: 'ui' });
    expect((await client.templates.get({ templateId })).template.slots[3]!.name).toBe('Laugh');
    // Older versions still open, read-only.
    expect((await client.templates.get({ templateId, version: 1 })).template.slots[0]!.approved).toBe(false);
    // Redo runs the edit again on the head it was made on: a new version, the same content.
    const versions = await client.templates.versions({ templateId });
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions[0]!.isHead).toBe(true);
  });
});
