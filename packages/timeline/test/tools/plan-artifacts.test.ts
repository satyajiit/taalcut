// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Plans kept as artifacts: written as JSON, read back raw and checked, refused as `plan` when broken. */
import { newId, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readPlan, storePlan } from '../../src/tools/plan-artifacts';
import { memoryArtifactStore } from '../fixtures/tool-context';

const schema = z.object({ revision: z.int().min(1) });

describe('plan artifacts', () => {
  it('reads back what was stored, raw and checked', async () => {
    const artifacts = memoryArtifactStore();
    const ref = await storePlan(artifacts, { revision: 3, extra: true }, 'a plan');
    if (!ref.ok) throw new Error(ref.error.code);
    expect(ref.value).toMatchObject({ mediaType: 'application/json', summary: 'a plan' });
    const read = await readPlan(artifacts, ref.value.id, schema);
    expect(read).toEqual(ok({ raw: { revision: 3, extra: true }, value: { revision: 3 } }));
  });

  it('refuses text that is not JSON, and JSON that is not the plan', async () => {
    const artifacts = memoryArtifactStore();
    const broken = newId<'Artifact'>();
    artifacts.raw(broken, '{ not json');
    const notJson = await readPlan(artifacts, broken, schema);
    expect(!notJson.ok && notJson.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'plan' },
    });
    const wrong = newId<'Artifact'>();
    artifacts.raw(wrong, JSON.stringify({ revision: 0 }));
    const notPlan = await readPlan(artifacts, wrong, schema);
    expect(!notPlan.ok && notPlan.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'plan' },
    });
  });
});
