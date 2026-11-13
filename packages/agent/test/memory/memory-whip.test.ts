// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM "Done when": a stated preference changes the next assembly. Two runs of the same assembly on a real local
 * model (Ollama qwen3.5:4b through @taalcut/models and pi-ai), replayed offline from the cassette
 * test/support/record-memory-whip.ts recorded: with nothing remembered the model picks a whip pan, the usual pick
 * for an energetic travel reel; with the creator's "Never use whip transitions." recalled into every system
 * prompt, it picks another transition. The requests match the recording byte for byte (no misses), so what the
 * recording shows the model was sent is what this agent sends.
 */
import { readFileSync } from 'node:fs';
import { unwrap } from '@taalcut/core';
import { openCassette } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { MEMORY_HEADING } from '../../src/memory';
import { harness, ofType } from '../support/harness';
import {
  ASSEMBLE,
  assemblyModule,
  NO_WHIP,
  qwenModels,
  rememberedNoWhip,
  WHIP_CASSETTE,
  WHIP_LOOP,
} from '../support/memory-model';

/** The system prompt of each recorded request, in order. */
function recordedSystems(): string[] {
  const file = JSON.parse(readFileSync(WHIP_CASSETTE, 'utf8')) as {
    interactions: { request: { body: { messages: { role: string; content: unknown }[] } } }[];
  };
  return file.interactions.map(({ request }) => {
    const system = request.body.messages.find((message) => message.role === 'system');
    return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content ?? '');
  });
}

describe('a stated preference changes the next assembly (recorded, LRN1-MEM)', () => {
  it('picks a whip pan with nothing remembered, and another transition once "never use whip" is recalled', async () => {
    const cassette = openCassette({ path: WHIP_CASSETTE, mode: 'replay' });
    const { client } = qwenModels(cassette.fetch);
    const run = async (remember: boolean) => {
      const h = harness({
        modules: [assemblyModule()],
        script: () => ({}),
        deps: { models: client, ...(remember ? { phase3: { memory: rememberedNoWhip() } } : {}) },
        settings: { loop: WHIP_LOOP },
      });
      const outcome = unwrap(await h.agent.run(ASSEMBLE));
      const events = await h.events(outcome.runId);
      const transitions = ofType(events, 'tool.requested')
        .filter((event) => event.payload.tool === 'assembly.assemble')
        .map((event) => (event.payload.input as { transition: string }).transition);
      return { status: outcome.status, events, transitions };
    };

    const before = await run(false);
    expect(before.status).toBe('completed');
    expect(before.transitions).toEqual(['whip']);
    expect(ofType(before.events, 'run.started')[0]!.payload.memory).toBeUndefined();

    const after = await run(true);
    expect(after.status).toBe('completed');
    expect(after.transitions).toHaveLength(1);
    expect(after.transitions[0]).not.toBe('whip');
    expect(ofType(after.events, 'run.started')[0]!.payload.memory).toMatchObject({
      use: 'on-device',
      items: [{ text: NO_WHIP.text, source: 'user' }],
    });

    expect(cassette.misses()).toEqual([]);
    expect(cassette.unused()).toBe(0);
  });

  it('sent the preference as the creator’s instruction in every system prompt of the second run, and none in the first', () => {
    const systems = recordedSystems();
    expect(systems).toHaveLength(6);
    const [first, second] = [systems.slice(0, 3), systems.slice(3)];
    expect(first.every((system) => !system.includes(MEMORY_HEADING))).toBe(true);
    for (const system of second) {
      expect(system).toContain(MEMORY_HEADING);
      expect(system).toContain('## What the creator told you');
      expect(system).toContain(`- ${NO_WHIP.text}`);
    }
  });
});
