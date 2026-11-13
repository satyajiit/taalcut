// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { newId, toolRunCardSchema } from '../src/index';

const card = {
  type: 'toolRun',
  id: 'cover:tool-1',
  version: 1,
  runId: newId<'AgentRun'>(),
  toolRunId: newId<'ToolRun'>(),
  tool: 'render.exportCover',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 2,
};
const savedCover = {
  fileName: 'airport-cover.jpg',
  assetId: newId<'Asset'>(),
  width: 1080,
  height: 1920,
  revision: 41,
};

it('keeps older tool cards compatible and round-trips a committed cover receipt', () => {
  expect(toolRunCardSchema.parse(card)).toEqual(card);
  expect(toolRunCardSchema.parse(JSON.parse(JSON.stringify({ ...card, savedCover })))).toEqual({
    ...card,
    savedCover,
  });
});

it.each(['/private/cover.jpg', '../cover.jpg', 'folder\\cover.jpg', 'cover.png', ''])(
  'rejects a cover path or non-JPEG name: %s',
  (fileName) => {
    expect(toolRunCardSchema.safeParse({ ...card, savedCover: { ...savedCover, fileName } }).success).toBe(
      false,
    );
  },
);

it('rejects an invalid cover asset, dimensions or revision', () => {
  for (const invalid of [{ assetId: 'invalid' }, { width: 0 }, { height: -1 }, { revision: 0 }])
    expect(toolRunCardSchema.safeParse({ ...card, savedCover: { ...savedCover, ...invalid } }).success).toBe(
      false,
    );
});
