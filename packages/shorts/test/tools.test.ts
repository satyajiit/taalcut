// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { toolModuleProblems } from '@taalcut/core';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createShortsService, shortsToolModule } from '../src';
import { fixtures } from './helpers';

it.each(['local', 'cloud'] as const)('declares valid %s tool metadata', (placement) => {
  const service = createShortsService(fixtures().deps);
  const module = shortsToolModule({ service: () => service, get: service.get, placement });
  expect(toolModuleProblems(module)).toEqual([]);
  for (const tool of module.tools) {
    expect(() => z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'throw' })).not.toThrow();
    expect(() => z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'throw' })).not.toThrow();
  }
  expect(module.tools[0]?.permission?.network).toBe(placement === 'local' ? 'lan' : 'internet');
});
