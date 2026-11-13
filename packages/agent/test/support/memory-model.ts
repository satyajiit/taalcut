// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM's recorded run: the same assembly asked twice of a real local model (Ollama qwen3.5:4b through
 * @taalcut/models), first with nothing remembered, then with the creator's "Never use whip transitions." recalled.
 * Shared by the recording script (record-memory-whip.ts, live Ollama) and the offline replay test
 * (memory/memory-whip.test.ts): both must send byte-identical requests, so everything that shapes them lives here.
 *
 * The assembly tool is a stand-in for the editor's: it takes the one transition the reel uses between its clips
 * and only reports it, so the test reads the model's choice.
 */
import { join } from 'node:path';
import {
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  TRANSITION_KINDS,
  type MemoryItemView,
  type ToolModule,
} from '@taalcut/core';
import { OLLAMA_DEFAULT_BASE_URL, type FetchFn, type ModelChoice } from '@taalcut/models';
import { z } from 'zod';
import type { MemoryRecallDeps } from '../../src/memory';
import { ollamaClient } from './local-model';

export const WHIP_CASSETTE = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'cassettes',
  'agent-ollama-memory-whip.json',
);
export const QWEN: ModelChoice = { provider: 'ollama', model: 'qwen3.5:4b-q4_K_M' };
export const ASSEMBLE = {
  conversationId: 'memory-whip',
  message:
    'Make my Goa trip reel. First call updatePlan with one step: "Assemble the reel". Then call assembly_assemble ' +
    'with the transition that suits a fast, energetic travel reel. Then tell me which transition you used.',
};
/** Deterministic sampling, so the recording is stable. */
export const WHIP_LOOP = { temperature: 0, reasoning: 'low' as const, maxOutputTokens: 2048 };

/** What the creator wrote in Settings → Memory, as the library lists it. */
export const NO_WHIP: MemoryItemView = {
  id: '01K7C5M6Q8Y00000000000000Z' as MemoryItemView['id'],
  scope: { kind: 'user' },
  scopeName: null,
  text: 'Never use whip transitions.',
  source: 'user',
  data: null,
  conversationId: null,
  revision: 1,
  createdAt: Date.UTC(2026, 9, 20),
  updatedAt: Date.UTC(2026, 9, 20),
};

/** Recall over one remembered item; the model runs on this Mac, so memory goes in. */
export function rememberedNoWhip(): MemoryRecallDeps {
  return {
    ranker: { rank: async () => ok([{ item: NO_WHIP, score: 1, matchedBy: ['recency'] }]) },
    cloudPrompts: async () => ok(true),
    leavesDevice: () => false,
  };
}

export function assemblyModule(): ToolModule {
  return defineToolModule({
    id: 'assembly',
    tools: [
      defineTool({
        name: 'assembly.assemble',
        version: '1.0.0',
        description:
          'Assembles the reel: its 12 clips cut on the beat, with one transition between every clip. Transitions: ' +
          'whip (a fast swish pan, the usual pick for energetic travel reels), zoom, flash, glitch, slide, ' +
          'dissolve, fade.',
        tags: ['assemble', 'transition'],
        input: z.object({
          transition: z.enum(TRANSITION_KINDS).describe('The transition between every clip.'),
        }),
        output: z.object({ assembled: z.literal(true), transition: z.enum(TRANSITION_KINDS) }),
        costClass: 'local',
        sideEffect: 'read',
        timeoutMs: 1_000,
        retry: NO_TOOL_RETRY,
        run: async (input) => ok({ assembled: true as const, transition: input.transition }),
      }),
    ],
  });
}

/** Where the recording reaches Ollama; the replay never connects. */
const baseUrl = () => process.env['TAALCUT_OLLAMA_URL'] ?? OLLAMA_DEFAULT_BASE_URL;

export function qwenModels(fetch: FetchFn) {
  return ollamaClient(
    fetch,
    { id: QWEN.model, contextWindow: 32_768, maxTokens: 2_048 },
    { baseUrl: baseUrl(), timeoutMs: 300_000 },
  );
}
