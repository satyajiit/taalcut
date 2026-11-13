// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A flow agent with the Phase 3 extensions composed as the agent root composes them: the stand-in domain
 * modules, the gap tools, the agent's own skills (brief and gaps) and, when a test asks, the voice lane's
 * stand-in Voice director and voice.finalize.
 */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  ULID_PATTERN,
  unwrap,
  type ProjectBudgetStore,
  type SkillModule,
  type ToolModule,
} from '@taalcut/core';
import {
  agentSkillModule,
  composeFlowExtensions,
  createSkillRegistry,
  gapsExtension,
  voiceExtension,
  voiceFinalizeExtension,
  type AutonomyLevel,
  type EventLogStore,
  type FlowExtension,
  type GapClips,
  type GapsDeps,
  type GapsJoinData,
  type ImagePath,
  type ModelScript,
} from '@taalcut/agent';
import { z } from 'zod';
import { flowSkillModules } from '../support/flow-skills';
import { createWorld, worldRefs } from '../support/flow-world';
import { harness, ofType, registryFor } from '../support/harness';
import { createGapWorld, gapToolModules, imagesModule, withStockSearch, type Planted } from './gap-world';
import { gapFlowScript } from './gap-script';

export interface GapHarnessOptions {
  readonly script?: ModelScript;
  readonly autonomy?: AutonomyLevel;
  readonly plan?: Planted[];
  /** The image path now; null: the images module isn't composed. Default: a US$0.04 path. */
  readonly image?: ImagePath | null;
  readonly stock?: boolean;
  readonly localOnly?: boolean;
  /** Compose the voice lane's stand-ins: whether voice can run, its draft lines, the template's audio. */
  readonly voice?: {
    readonly available: boolean;
    readonly drafts?: number;
    readonly audio?: 'voice' | 'music';
  };
  readonly budgets?: ProjectBudgetStore;
  readonly store?: EventLogStore;
  /** Which extensions to compose (default: every one whose lane is composed). */
  readonly extensions?: readonly string[];
  /** FIX-ASK: the person's new clips (Add more clips is offered only with it), and how long to wait for them. */
  readonly clips?: GapClips;
  readonly clipWait?: GapsDeps['clipWait'];
}

export const PATH: ImagePath = {
  ok: true,
  provider: 'openrouter',
  model: 'x-ai/grok-imagine-image-2.0',
  usdPerImage: 0.04,
  estimated: false,
};

const ulid = z.string().regex(ULID_PATTERN);

function voiceModules(): { tools: ToolModule; skills: SkillModule; finalized: string[] } {
  const finalized: string[] = [];
  const tools = defineToolModule({
    id: 'voice',
    tools: [
      defineTool({
        name: 'voice.finalize',
        version: '1.0.0',
        description: 'Re-voices the draft lines of a timeline with the final model.',
        input: z.object({ timelineId: ulid }),
        output: z.object({ timelineId: ulid, finalized: z.int() }),
        sideEffect: 'write',
        command: 'voice.finalize',
        idempotencyKey: (input) => `finalize:${input.timelineId}`,
        costClass: 'local',
        timeoutMs: 2_000,
        retry: NO_TOOL_RETRY,
        run: async (input, ctx) => {
          const done = await ctx.dispatch(input);
          if (!done.ok) return done;
          finalized.push(input.timelineId);
          return ok({ timelineId: input.timelineId, finalized: 2 });
        },
      }),
    ],
  });
  const director = defineSkill({
    id: 'voice.director',
    version: '1.0.0',
    labelKey: 'skills.voice.director',
    description: 'Writes and places a voiceover on the beat.',
    prompt: 'Write the lines, voice them as drafts, place them, hand off.',
    tools: { names: ['voice.finalize'] },
    input: z.object({ projectId: ulid, timelineId: ulid }),
    output: z.object({ timelineId: ulid, lines: z.int() }),
    refs: () => [],
  });
  return { tools, skills: defineSkillModule({ id: 'voice', skills: [director] }), finalized };
}

export function gapHarness(options: GapHarnessOptions = {}) {
  const world = createWorld();
  const gaps = createGapWorld(world, options.plan);
  const image = options.image === undefined ? PATH : options.image;
  const voice = options.voice ? voiceModules() : undefined;
  let modules = gapToolModules(gaps, [
    ...(image ? [imagesModule(gaps, image.ok ? image.usdPerImage : 0)] : []),
    ...(voice ? [voice.tools] : []),
  ]);
  if (options.stock) modules = withStockSearch(modules);
  const registry = registryFor(modules);
  const registered = (tool: string) => registry.describe(tool) !== undefined;
  const deps: GapsDeps = {
    source: gaps.source,
    ...(image ? { images: async () => image } : {}),
    ...(options.stock ? { stock: () => ({ ok: true as const }) } : {}),
    localOnly: () => options.localOnly ?? false,
    ...(options.clips ? { clips: options.clips } : {}),
    ...(options.clipWait ? { clipWait: options.clipWait } : {}),
  };
  const skills = unwrap(
    createSkillRegistry(
      [
        ...flowSkillModules(world),
        agentSkillModule({ gaps: { deps, registered } }),
        ...(voice ? [voice.skills] : []),
      ],
      registry,
    ),
  );
  const all: FlowExtension[] = [
    gapsExtension({ ...deps, registered }),
    ...(options.voice
      ? [
          voiceExtension({
            available: () => options.voice?.available ?? false,
            templateAudio: async () => ok(options.voice?.audio ?? null),
          }),
          voiceFinalizeExtension({ draftLines: async () => ok(options.voice?.drafts ?? 0) }),
        ]
      : []),
  ];
  const chosen = options.extensions ? all.filter((e) => options.extensions?.includes(e.id)) : all;
  const flowExtensions = unwrap(composeFlowExtensions(chosen, skills, registered));
  const h = harness({
    script: options.script ?? gapFlowScript({ ask: false }),
    modules,
    ...(options.store ? { store: options.store } : {}),
    settings: { autonomy: options.autonomy ?? 'before-render', localOnly: options.localOnly ?? false },
    deps: {
      skills,
      refs: worldRefs(world),
      flows: { staleAfterMs: 5 },
      phase3: { flowExtensions },
      // A run the chat starts makes its project in the world (FIX-ASK's chat answers).
      projects: { forConversation: async () => ok(world.projectId) },
      ...(options.budgets ? { budgets: options.budgets } : {}),
    },
  });
  return { ...h, world, gaps, skills, finalized: voice?.finalized ?? [] };
}

/** The gaps step's latest round of facts, as logged. */
export function latestGapData(events: Parameters<typeof ofType>[0]): GapsJoinData | undefined {
  return ofType(events, 'flow.extended')
    .filter((e) => e.payload.extension === 'gaps')
    .at(-1)?.payload.data as GapsJoinData | undefined;
}

/**
 * FIX-ASK: waits for the run and, each time it asks about the gaps, answers with what the card proposed (every gap's
 * default fix), as a person who takes the defaults would. Other questions and approvals are left to the test.
 */
export async function takeGapDefaults(
  h: ReturnType<typeof gapHarness>,
  runId: Parameters<typeof h.agent.wait>[0],
) {
  let outcome = unwrap(await h.agent.wait(runId));
  for (let round = 0; round < 5; round++) {
    const pending = outcome.pending[0];
    const events = await h.events(runId);
    const asked = ofType(events, 'approval.requested').find(
      (e) => e.payload.requestId === pending?.requestId,
    );
    if (!pending || asked?.payload.question !== 'gapFix') return outcome;
    const data = latestGapData(events);
    const fixes = (data?.gaps ?? [])
      .filter((g) => !g.settled)
      .map((g) => ({
        gapId: g.row.gapId,
        fix: g.row.fix,
        ...(g.row.swapTo ? { swapTo: g.row.swapTo } : {}),
      }));
    outcome = unwrap(
      await h.agent.answer(runId, {
        requestId: pending.requestId,
        decision: 'approve',
        answer: { kind: 'gapFix', fixes } as never,
      }),
    );
  }
  return outcome;
}
