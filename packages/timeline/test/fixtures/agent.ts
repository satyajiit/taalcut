// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small stand-in for the agent around the timeline tools: one bus, one
 * store, a cast world, and a tool context whose dispatch goes to the bus with
 * source 'agent', as @taalcut/agent's command dispatcher does.
 */
import type { CompositionFiles } from '../../src/assembly/composition-files';
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  forwardCommandEvents,
  newId,
  ok,
  type SubjectSource,
} from '@taalcut/core';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { createTimelineCommands } from '../../src/commands/commands';
import { createTimelineService } from '../../src/service/service';
import { memoryTemplateReader, type TemplateReader } from '../../src/service/templates';
import type { GraphicsReady } from '../../src/tools/graphics-wait';
import { timelineToolModule } from '../../src/tools/module';
import type { ShotDescriptions } from '../../src/tools/rerank-material';
import { world, type World, type WorldDef } from './casting';
import { createMemoryTimelineStore } from './store';
import { agentToolContext, memoryArtifactStore } from './tool-context';

/** `keptAudio`: the template keeps its reel with sound (REF1), so assembly gives each cut the reel's music. */
export function agentWorld(
  def: WorldDef = { slots: 4, perSlot: 5, distractors: 20, seed: 41 },
  keptAudio = false,
) {
  return agentWorldOver(world(def), { keptAudio });
}

export interface AgentWorldOptions {
  readonly keptAudio?: boolean;
  /** What indexing said each shot shows, for timeline.cast's rerank (FIX-LIBRARIAN). */
  readonly shotDescriptions?: ShotDescriptions;
  /** FRM1-OVL: who is in each clip, for placing the overlays clear of heads. */
  readonly subjects?: SubjectSource;
  /** HFW1: where a make puts a template's composition files. */
  readonly workspace?: CompositionFiles;
  /** FIX-GFXWAIT: the templates the tools read (default: the world's one template), and the wait for graphics. */
  readonly templates?: TemplateReader;
  readonly graphicsReady?: GraphicsReady;
}

/** The tools and stores over a casting world built elsewhere (a library of the test's own making). */
export function agentWorldOver(cast: World, options: AgentWorldOptions = {}) {
  const keptAudio = options.keptAudio ?? false;
  const clock = createManualClock(10);
  const events = createEventBus({ clock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  forwardCommandEvents(bus, events);
  const store = createMemoryTimelineStore();
  const templates =
    options.templates ?? memoryTemplateReader([cast.template], keptAudio ? [cast.template.id] : []);
  const subjects = options.subjects ? { subjects: options.subjects } : {};
  bus.register(
    ...createTimelineCommands({
      store,
      events,
      clock,
      catalog: createMemoryShotCatalog(cast.profiles),
      ...(options.subjects ? { templates, subjects: options.subjects } : {}),
    }).all,
  );
  const service = createTimelineService({ store, events, engine: cast.engine, templates });
  const shotDescriptions = options.shotDescriptions ? { shotDescriptions: options.shotDescriptions } : {};
  const tools = timelineToolModule({
    engine: cast.engine,
    service,
    templates,
    clock,
    ...shotDescriptions,
    ...subjects,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    ...(options.graphicsReady ? { graphicsReady: options.graphicsReady } : {}),
  });
  const artifacts = memoryArtifactStore();
  const projectId = newId<'Project'>();

  /** Validates the input as the registry would, runs the tool, and validates its output. */
  async function call(name: string, input: unknown) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool ${name}`);
    const parsed = tool.input.safeParse(input);
    if (!parsed.success) throw new Error(`${name} input: ${parsed.error.message}`);
    const result = await tool.run(parsed.data, agentToolContext(bus, tool, artifacts));
    if (!result.ok) return result;
    return ok(tool.output.parse(result.value) as Record<string, unknown>);
  }

  return { ...cast, bus, store, service, templates, tools, call, projectId, artifacts };
}
