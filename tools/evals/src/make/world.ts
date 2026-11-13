// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: one make's world, from its source: a made-up case (the made-up library, its words as vectors), or the
 * owner check's clone of a library (outside the repo). Core's command bus with the timeline's commands and render's
 * graphics commands over the edit eval's in-memory store; the template in a memory reader; casting over the source's
 * catalog; and the tools a make's last stretch uses: timeline.get and the clip edits a slot fix names,
 * library.search, graphics.list and graphics.edit, graphics.design (stand-ins.ts), render.draft (draft.ts: render's
 * slot checks with no pixels, measure.ts) and render's real video.done over the eval's drafts.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  ok,
  type AnyTool,
  type AsyncResult,
  type CommandOrigin,
  type Embedder,
  type ProjectId,
  type ShotProfileSource,
  type SubjectSource,
  type Template,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import {
  compositionToolModule,
  createCompositionCommands,
  timelineAccessOverStore,
  videoDoneTool,
} from '@taalcut/render';
import {
  clipNumberingOf,
  createCastingEngine,
  createMemoryShotCatalog,
  createTimelineCommands,
  createTimelineService,
  memoryTemplateReader,
  timelineToolModule,
  type ShotCatalog,
} from '@taalcut/timeline';
import { idCounter } from '../edit/ids';
import { memoryStore, type EvalTimelineStore } from '../edit/world';
import { caseTemplate, type MakeCase } from './cases';
import { draftTimeline } from './draft-doc';
import { evalDraftTool, evalRenders } from './draft';
import {
  describeShots,
  MAKE_PROFILES,
  MAKE_SHOTS,
  MEDIA_FRAMES,
  makeSubjects,
  wordsEmbedder,
} from './footage';
import { measureSlots } from './measure';
import { makeDesignStandIn, makeLibrarySearch, type DesignJobs, type SearchShot } from './stand-ins';

const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:eval-make' };

/** The timeline tools a slot fix names, and the read that goes with them. */
export const MAKE_TIMELINE_TOOLS = [
  'timeline.get',
  'timeline.findAlternates',
  'timeline.swapClip',
  'timeline.slipClip',
  'timeline.setReframe',
  'timeline.trimClip',
  'timeline.setSpeed',
] as const;

/** What a make's world is made from. */
export interface MakeSource {
  readonly id: string;
  readonly template: Template;
  /** The first draft, as a cast and assembly left it. */
  readonly first: Timeline;
  readonly catalog: ShotCatalog;
  /** Casting's and the needs' query embedder. */
  readonly embedder: Embedder;
  readonly profiles: Pick<ShotProfileSource, 'profiles'>;
  readonly subjects: SubjectSource;
  readonly describe: (shotIds: readonly string[]) => ReadonlyMap<string, string>;
  /** What library.search finds. */
  readonly library: readonly SearchShot[];
  /** Slots (numbers, from 1) no shot of the library can match. */
  readonly unmatchable?: readonly number[];
}

export interface MakeWorld {
  readonly id: string;
  readonly unmatchable: readonly number[];
  readonly template: Template;
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly store: EvalTimelineStore;
  readonly tools: readonly AnyTool[];
  readonly dispatch: (command: string, payload: unknown) => AsyncResult<unknown>;
  readonly renders: ReturnType<typeof evalRenders>;
  readonly jobs: DesignJobs;
  /** Render's slot facts and checks on a timeline, over the source's library. */
  measure(timeline: Timeline): ReturnType<typeof measureSlots>;
  timeline(): Timeline;
}

/** A made-up case as a source (cases.ts, footage.ts). */
export function caseSource(made: MakeCase): MakeSource {
  const template = caseTemplate(made);
  return {
    id: made.id,
    template,
    first: draftTimeline(made, template),
    catalog: createMemoryShotCatalog(MAKE_PROFILES),
    embedder: wordsEmbedder,
    profiles: createMemoryShotCatalog(MAKE_PROFILES),
    subjects: makeSubjects(),
    describe: describeShots,
    library: MAKE_SHOTS.map((shot) => ({ ...shot, seconds: MEDIA_FRAMES / 30 })),
    ...(made.unmatchable ? { unmatchable: made.unmatchable } : {}),
  };
}

export const makeWorld = (made: MakeCase) => sourceWorld(caseSource(made));

export async function sourceWorld(source: MakeSource): Promise<MakeWorld> {
  const { template, catalog, subjects } = source;
  const clock = createManualClock(1_760_000_000_000);
  const events = createEventBus({ clock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  const store = memoryStore();
  const templates = memoryTemplateReader([template]);
  const timelineCommands = createTimelineCommands({
    store,
    events,
    clock,
    catalog,
    subjects,
    ids: idCounter('01K9ME'),
  });
  const access = timelineAccessOverStore(store, { now: () => clock.now() });
  bus.register(
    ...timelineCommands.all,
    ...createCompositionCommands({ timelines: access, newItemId: idCounter('01K9MH') }).all,
  );
  timelineCommands.announce(bus);

  const engine = createCastingEngine({ catalog, embedder: source.embedder });
  const service = createTimelineService({ store, events, engine, templates });
  const wanted = new Set<string>(MAKE_TIMELINE_TOOLS);
  const timelineTools = timelineToolModule({
    engine,
    service,
    templates,
    clock,
    shotDescriptions: async (ids) => ok(source.describe(ids)),
    numbering: clipNumberingOf(store),
  }).tools.filter((tool) => wanted.has(tool.name));
  const graphicsTools = compositionToolModule({ timelines: access }).tools.filter(
    (tool) => tool.name === 'graphics.list' || tool.name === 'graphics.edit',
  );
  const renders = evalRenders();
  const design = makeDesignStandIn(store, template);
  const measure = (timeline: Timeline) =>
    measureSlots(timeline, template, { subjects, profiles: source.profiles, embedder: source.embedder });
  const tools: AnyTool[] = [
    ...timelineTools,
    makeLibrarySearch(source.library),
    ...graphicsTools,
    design.tool,
    evalDraftTool({ store, measure, renders }),
    videoDoneTool({
      store: renders,
      timelines: access,
      templateSlots: async () => ok(template.slots.map((slot) => slot.id)),
    }),
  ];

  const { first } = source;
  const created = await bus.dispatch(
    'timeline.create',
    { projectId: first.projectId, timelines: [first] },
    UI,
  );
  if (!created.ok)
    throw new Error(`${source.id}: timeline.create ${created.error.code} ${created.error.detail ?? ''}`);
  const dispatch = async (command: string, payload: unknown) => {
    const done = await bus.dispatch(command, payload, AGENT);
    return done.ok ? ok(done.value.result) : done;
  };
  return {
    id: source.id,
    unmatchable: source.unmatchable ?? [],
    template,
    projectId: first.projectId,
    timelineId: first.id,
    store,
    tools,
    dispatch,
    renders,
    jobs: design.jobs,
    measure,
    timeline: () => store.read(first.id),
  };
}
