// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chatHistoryEventSchema } from '@taalcut/core';
import { expect, it } from 'vitest';
import { WORKSPACE_ANSWER, workspaceSeeds } from '../src/chat/fake-workspace-script';
import { replay } from '../src/chat/transcript';

it('replays the closing-shot example with both command results and its saved artifact reference', () => {
  const seed = workspaceSeeds()[0]!;
  for (const event of seed.history) expect(chatHistoryEventSchema.safeParse(event).success).toBe(true);
  const transcript = replay(seed.history);
  expect(transcript.items.some((item) => item.kind === 'unsupported')).toBe(false);
  const tools = transcript.items.flatMap((item) =>
    item.kind === 'card' && item.card.type === 'toolRun' ? [item.card] : [],
  );
  expect(tools).toHaveLength(2);
  expect(tools.every((card) => card.tool === 'workspace.exec' && card.status === 'succeeded')).toBe(true);
  expect(tools.map((card) => card.summary)).toEqual(
    expect.arrayContaining([expect.stringContaining('exit 0')]),
  );
  expect(tools[1]!.artifactIds).toEqual(['closing-shot-inspection']);
  expect(transcript.items.filter((item) => item.kind === 'agent')).toHaveLength(2);
  expect(transcript.items.at(-1)).toMatchObject({ kind: 'agent', text: WORKSPACE_ANSWER, streaming: false });
});

it('keeps the failed final-frame check retryable and never claims it saved a result', () => {
  const seed = workspaceSeeds()[1]!;
  for (const event of seed.history) expect(chatHistoryEventSchema.safeParse(event).success).toBe(true);
  const transcript = replay(seed.history);
  const failed = transcript.items.find(
    (item) => item.kind === 'card' && item.card.type === 'toolRun' && item.card.status === 'failed',
  );
  expect(failed).toMatchObject({
    kind: 'card',
    card: { error: { code: 'core.timeout', fix: { command: 'agent.retryStep' } } },
  });
  expect(
    failed?.kind === 'card' && failed.card.type === 'toolRun' && failed.card.artifactIds,
  ).toBeUndefined();
  expect(Object.values(transcript.runs)).toEqual(['failed']);
});
