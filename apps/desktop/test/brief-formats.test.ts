// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review H1: the agent's brief skill hands a format to the Librarian, which plans it with
 * `templates.planFromFormat`. The two packages can't see each other, so the composition root's tests check that
 * every format the brief may name is one the plan tool accepts.
 */
import { describe, expect, it } from 'vitest';
import { FORMAT_IDS } from '@taalcut/core';
import { briefSkill } from '@taalcut/agent';
import { planFromFormatInputSchema } from '@taalcut/templates';

describe('the brief path', () => {
  it('only offers formats templates.planFromFormat plans, and that is all of core’s', () => {
    for (const formatId of FORMAT_IDS) {
      expect(briefSkill.output.safeParse({ text: 'a brief', formatId }).success, formatId).toBe(true);
      expect(
        planFromFormatInputSchema.shape.formatId.safeParse(formatId).success,
        `planFromFormat accepts ${formatId}`,
      ).toBe(true);
    }
  });
});
