// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { GATE_DEMO_FIXTURES } from '../src';

interface RecordedTool {
  name: string;
}
interface Tape {
  recordedAt: string;
  note: string;
  interactions: {
    request: { body: { tools?: RecordedTool[] } };
    response: { status: number; headers: Record<string, string>; chunks: string[] };
  }[];
}
interface Recording {
  sourceRecordedAt: string;
  recordedAt: string;
  interactionCount: number;
  editorOfferRequests: number[];
  sourceResponseSha256: string;
  responseSha256: string;
}
const read = (name: string) => readFileSync(join(GATE_DEMO_FIXTURES, name), 'utf8');
const manifest = JSON.parse(read('editor-rerecord.json')) as {
  provider: string;
  upstreamCalls: number;
  sessions: Record<string, Recording>;
};
const currentEditor = (JSON.parse(read('edit-chat.cassette.json')) as Tape).interactions[0]!.request.body
  .tools!;

for (const [session, recorded] of Object.entries(manifest.sessions)) {
  const tape = JSON.parse(read(`${session}.cassette.json`)) as Tape;

  it(`${session}: records the real stand-in journey with every original response byte intact`, () => {
    expect(manifest.provider).toBe('documented in-process deterministic stand-in');
    expect(manifest.upstreamCalls).toBe(0);
    expect(tape.note).toContain('Recorded by @taalcut/models');
    expect(tape.recordedAt).toBe(recorded.recordedAt);
    expect(Date.parse(recorded.recordedAt)).toBeGreaterThan(Date.parse(recorded.sourceRecordedAt));
    expect(tape.interactions).toHaveLength(recorded.interactionCount);
    const digest = createHash('sha256')
      .update(JSON.stringify(tape.interactions.map((row) => row.response)))
      .digest('hex');
    expect(digest).toBe(recorded.responseSha256);
    expect(digest).toBe(recorded.sourceResponseSha256);
    expect(recorded.editorOfferRequests).toEqual([0, 1, 2]);
    for (const index of recorded.editorOfferRequests) {
      expect(tape.interactions[index]!.request.body.tools).toEqual(currentEditor);
    }
    for (const interaction of tape.interactions) {
      for (const chunk of interaction.response.chunks) {
        for (const line of chunk.split('\n').filter((line) => line.startsWith('data: {'))) {
          const event = JSON.parse(line.slice(6)) as { content_block?: { type: string; name?: string } };
          if (event.content_block?.type === 'tool_use')
            expect(interaction.request.body.tools?.map((tool) => tool.name)).toContain(
              event.content_block.name,
            );
        }
      }
    }
  });
}
