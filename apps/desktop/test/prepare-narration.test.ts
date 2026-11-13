// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap } from '@taalcut/core';
import { createPrepareNarration } from '@taalcut/timeline';
import { createToolRegistry } from '@taalcut/tools';
import { expect, it, vi } from 'vitest';

it('registers the preparation command tool in the timeline catalogue without adding history', () => {
  const prepared = createPrepareNarration({ timelines: { get: vi.fn() }, events: { emit: vi.fn() } });
  const registry = unwrap(createToolRegistry([prepared.tools]));
  expect(registry.moduleIds()).toEqual(['timeline']);
  expect(registry.describe('timeline.prepareNarration')).toMatchObject({
    name: 'timeline.prepareNarration',
    sideEffect: 'write',
    command: 'timeline.prepareNarration',
  });
  expect(unwrap(registry.loadSchemas(['timeline.prepareNarration']))).toHaveLength(1);
  expect(prepared.command.sideEffect).toBe('read');
});
