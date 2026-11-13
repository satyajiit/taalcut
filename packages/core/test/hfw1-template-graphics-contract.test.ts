// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 retire, a template's graphics: a composition's values, and `template.setGraphics` setting the compositions
 * and the overlays they draw (never the reading). DSG1's components are gone. Made-up records.
 */
import { describe, expect, it } from 'vitest';
import { graphicParamValuesSchema, newId, TEMPLATE_COMMANDS, templateCommandPayloads } from '../src';
import { COMPOSITION } from './helpers/hfw1';

const payload = (graphics: unknown) => ({
  projectId: null,
  templateId: newId<'Template'>(),
  baseVersion: 1,
  graphics,
});
const setGraphics = templateCommandPayloads[TEMPLATE_COMMANDS.setGraphics];

describe('a template’s graphics (HFW1 retire)', () => {
  it('values are strings, numbers or booleans, at most 16', () => {
    expect(graphicParamValuesSchema.safeParse({ text: 'Hi', size: 1.2, receipt: false }).success).toBe(true);
    expect(graphicParamValuesSchema.safeParse({ text: { html: '<b>' } }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, true]));
    expect(graphicParamValuesSchema.safeParse(many).success).toBe(false);
  });

  it('template.setGraphics takes compositions and their uses, or none, and never a reading', () => {
    const overlayId = newId<'TextOverlay'>();
    const graphics = { compositions: [COMPOSITION], uses: [{ overlayId, compositionId: COMPOSITION.id }] };
    expect(setGraphics.safeParse(payload(graphics)).success).toBe(true);
    expect(setGraphics.safeParse(payload(null)).success).toBe(true);
    expect(setGraphics.safeParse(payload({ uses: [{ overlayId }] })).success).toBe(false);
    const set = setGraphics.parse(payload({ uses: [], reading: { version: 1 } }));
    expect(set.graphics).toEqual({ uses: [] });
  });
});
