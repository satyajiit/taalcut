// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** fromHubTemplate mints new ids and a manual template the schema accepts. */
import { describe, expect, it } from 'vitest';
import { templateSchema } from '@taalcut/core';
import { fromHubTemplate } from '../../src/hub/from-hub';
import { T0 } from '../helpers/fixtures';
import { hubIds, sharedDocument } from './helpers';

describe('fromHubTemplate', () => {
  it('keeps roles, durations and beats, and replaces every id', () => {
    const { template, doc } = sharedDocument();
    const built = fromHubTemplate(doc, hubIds(), T0);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const local = built.value;
    expect(templateSchema.safeParse(local).success).toBe(true);
    expect(local.id).not.toBe(template.id);
    expect(local.slots.map((slot) => slot.id)).not.toEqual(template.slots.map((slot) => slot.id));
    expect(local.text.map((item) => item.id)).not.toEqual(template.text.map((item) => item.id));
    expect(local.slots.map((slot) => slot.role)).toEqual(template.slots.map((slot) => slot.role));
    expect(local.slots.map((slot) => slot.duration)).toEqual(template.slots.map((slot) => slot.duration));
    expect(local.beatMap?.beats).toHaveLength(template.beatMap?.beats.length ?? 0);
    expect(local.origin).toEqual({ kind: 'manual' });
    expect(local.slots.every((slot) => slot.approved === false && slot.frame === null)).toBe(true);
    expect(local.slots.every((slot) => slot.cut.method === 'user' && slot.cut.confidence === 1)).toBe(true);
    expect(local.slots.every((slot) => slot.intent.source === 'user')).toBe(true);
    expect(local.contactSheet).toBeNull();
    expect(local.audio.sound).toBeNull();
    expect(local.audio.waveform).toBeNull();
    expect(local.text.map((item) => item.text)).toEqual(['{title}', '{title}']);
    expect(local.text.map((item) => item.slotId)).toEqual([local.slots[1]!.id, local.slots[3]!.id]);
    expect(local.createdAt).toBe(T0);
    expect(local.version).toBe(1);
    expect(local.parentVersion).toBeNull();
  });
});
