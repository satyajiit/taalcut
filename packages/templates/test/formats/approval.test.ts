// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The library approval these plans can reach: template.slot.approve on every slot. */
import { describe, expect, it } from 'vitest';
import { FORMAT_IDS, TEMPLATE_COMMANDS as N } from '@taalcut/core';
import { requirePlan } from './helpers';
import { setupTemplates, UI } from '../helpers/setup';

const DURATIONS = [15, 30, 60] as const;

describe.each(FORMAT_IDS)('approve %s', (formatId) => {
  it.each(DURATIONS)('approves every slot at %i s', async (seconds) => {
    const template = requirePlan(formatId, seconds);
    expect(template.slots.length).toBeGreaterThan(0);
    expect(template.slots.length).toBeLessThanOrEqual(200);
    const { bus, service, projectA } = setupTemplates();
    const created = await bus.dispatch(
      N.create,
      { projectId: projectA, template, name: formatId, listed: true },
      UI,
    );
    expect(created.ok).toBe(true);
    const approved = await bus.dispatch(
      N.approveSlots,
      {
        projectId: projectA,
        templateId: template.id,
        baseVersion: 1,
        slotIds: template.slots.map((slot) => slot.id),
      },
      UI,
    );
    expect(approved.ok && approved.value.result).toEqual({ templateId: template.id, version: 2 });
    const got = await service.get({ templateId: template.id });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.template.slots.every((slot) => slot.approved)).toBe(true);
    expect(got.value.template.version).toBe(2);
  });
});
