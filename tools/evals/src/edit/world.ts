// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's world. Core's real command bus with the timeline's commands and render's caption and
 * graphics commands over one in-memory store, the tool modules the Editor names (timeline, the sound's edits,
 * captions, graphics, comments, and stand-ins for library and templates: stand-ins.ts), and the Editor 2.0 alone as
 * the skill. The video is timeline-doc.ts's, with captions built from its words and one lower third on, every id fixed.
 * FIX-CMT: the library's comment commands on the same bus and store, and the batches the chat reads them into.
 */
import { join } from 'node:path';
import {
  ConflictError,
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineSkillModule,
  defineToolModule,
  err,
  forwardCommandEvents,
  NotFoundError,
  ok,
  RationalTime,
  type AnySkill,
  type CommandBus,
  type CommandOrigin,
  type CommentBatchPort,
  type CommentStore,
  type Embedder,
  type ProjectId,
  type SkillModule,
  type Timeline,
  type TimelineStore,
  type TimelineSummary,
  type ToolModule,
} from '@taalcut/core';
import { commentToolModule, createCommentBatches, createCommentCommands } from '@taalcut/library';
import { editorCatalogueTool, editorHistoryTools } from '@taalcut/tools';
import {
  captionToolModule,
  compositionToolModule,
  createCaptionCommands,
  createCompositionCommands,
  createTextMeasurer,
  timelineAccessOverStore,
} from '@taalcut/render';
import {
  audioEditToolModule,
  clipNumberingOf,
  createCastingEngine,
  createMemoryShotCatalog,
  createPrepareNarration,
  createTimelineCommands,
  createTimelineService,
  memoryTemplateReader,
  timelineSkillModule,
  timelineToolModule,
} from '@taalcut/timeline';
import { ALL_SHOTS, describeShots, profileOf, transcriptOf } from './footage';
import { editEditorCapabilities } from './editor-catalogue';
import { idCounter } from './ids';
import { libraryStandIn, memoryCommentStore, templatesStandIn } from './stand-ins';
import { withLowerThird } from './seed-graphic';
import { subjectsStandIn } from './subjects';
import { editTimeline, PROJECT_ID, TIMELINE_ID } from './timeline-doc';

const FONTS_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'render', 'fonts');
const UI: CommandOrigin = { source: 'ui', actor: 'user' };

/** An in-memory TimelineStore with the optimistic revision check the library's has; documents kept as JSON. */
export interface EvalTimelineStore extends TimelineStore {
  read(timelineId: string): Timeline;
}

export function memoryStore(): EvalTimelineStore {
  const docs = new Map<string, string>();
  const summary = (timeline: Timeline): TimelineSummary => ({
    id: timeline.id,
    projectId: timeline.projectId,
    name: timeline.name,
    revision: timeline.revision,
    duration: RationalTime.zero(timeline.canvas.rate),
    clipCount: 0,
    template: timeline.template,
    castId: null,
    variantIndex: null,
    updatedAt: timeline.updatedAt,
  });
  const parsed = (id: string): Timeline | undefined => {
    const json = docs.get(id);
    return json === undefined ? undefined : (JSON.parse(json) as Timeline);
  };
  return {
    read(timelineId) {
      const found = parsed(timelineId);
      if (!found) throw new Error(`No timeline ${timelineId}`);
      return found;
    },
    async create(timeline) {
      if (docs.has(timeline.id)) return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      docs.set(timeline.id, JSON.stringify(timeline));
      return ok(summary(timeline));
    },
    async put(timeline, expectedRevision) {
      const stored = parsed(timeline.id);
      if (!stored) return err(NotFoundError({ entity: 'timeline', id: timeline.id }));
      if (stored.revision !== expectedRevision)
        return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      docs.set(timeline.id, JSON.stringify(timeline));
      return ok(summary(timeline));
    },
    async get(timelineId) {
      const stored = parsed(timelineId);
      if (!stored) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      return ok({ summary: summary(stored), schemaVersion: stored.schemaVersion, json: stored });
    },
    async listByProject(projectId: ProjectId) {
      return ok(
        [...docs.keys()].flatMap((id) => {
          const found = parsed(id);
          return found && found.projectId === projectId ? [summary(found)] : [];
        }),
      );
    },
    async remove(timelineId) {
      if (!docs.delete(timelineId)) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      return ok(undefined);
    },
  };
}

/** Casting never runs in the eval; findAlternates' engine only needs an embedding space. */
const noEmbedder: Embedder = {
  space: { model: 'eval', revision: 'none', dimensions: 8, indexName: 'eval' },
  embedTexts: async (texts) => ok(texts.map(() => new Float32Array(8))),
};

export interface EditWorld {
  readonly bus: CommandBus;
  readonly store: EvalTimelineStore;
  readonly modules: readonly ToolModule[];
  readonly skills: readonly SkillModule[];
  readonly projectId: ProjectId;
  readonly timelineId: Timeline['id'];
  /** FIX-CMT: the comments, and the batches a message's comments are read into (the chat's). */
  readonly comments: CommentStore;
  readonly batches: CommentBatchPort;
  /** The video now. */
  timeline(): Timeline;
}

/** New graphics' ids, after the seeded lower third's (seed-graphic.ts). */
function graphicIds() {
  const next = idCounter<'TimelineItem'>('01K8EG');
  next();
  return next;
}

export async function editWorld(): Promise<EditWorld> {
  const clock = createManualClock(1_760_000_000_000);
  const events = createEventBus({ clock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  forwardCommandEvents(bus, events);
  const store = memoryStore();
  const catalog = createMemoryShotCatalog(ALL_SHOTS.map(profileOf));
  const templates = memoryTemplateReader([]);
  // FIX-TRIM: made-up subject tracks, so a slip away from a face has faces to go by (subjects.ts).
  const subjects = subjectsStandIn();
  const timelineCommands = createTimelineCommands({
    store,
    events,
    clock,
    catalog,
    subjects,
    ids: idCounter('01K8EC'),
    transcripts: async (assetId) => ok(transcriptOf(assetId)),
  });
  const access = timelineAccessOverStore(store, { now: () => clock.now() });
  const comments = memoryCommentStore();
  const recorder = createPrepareNarration({ timelines: store, events });
  const measurer = await createTextMeasurer(FONTS_DIR);
  bus.register(
    ...timelineCommands.all,
    ...createCaptionCommands({
      timelines: access,
      transcripts: { transcript: async (assetId) => ok(transcriptOf(assetId)) },
      measurer,
      newCueId: idCounter('01K8EQ'),
    }).all,
    ...createCompositionCommands({ timelines: access, newItemId: graphicIds() }).all,
    ...createCommentCommands({ store: comments, timelines: store, clock }).all,
    recorder.command,
  );
  timelineCommands.announce(bus);

  const engine = createCastingEngine({ catalog, embedder: noEmbedder });
  const service = createTimelineService({
    store,
    events,
    engine,
    templates,
    transcripts: async (assetId) => ok(transcriptOf(assetId)),
  });
  const modules: ToolModule[] = [
    // The sound's edits in the audio module count on the same reads of timeline.get, as in the app.
    defineToolModule({
      id: 'timeline',
      tools: [
        ...timelineToolModule({
          engine,
          service,
          templates,
          clock,
          shotDescriptions: async (ids) => ok(describeShots(ids)),
          numbering: clipNumberingOf(store),
        }).tools,
        ...recorder.tools.tools,
      ],
    }),
    defineToolModule({ id: 'audio', tools: audioEditToolModule({ timelines: store }).tools }),
    captionToolModule(access),
    compositionToolModule({ timelines: access }),
    libraryStandIn(),
    templatesStandIn(),
    commentToolModule({ store: comments, timelines: store }),
    editorHistoryTools(bus),
  ];
  const capabilities = () =>
    editEditorCapabilities((name) =>
      modules.some((module) => module.tools.some((tool) => tool.name === name)),
    );
  modules.push(editorCatalogueTool(capabilities));
  const editor = timelineSkillModule({
    service,
    templates,
    numbering: clipNumberingOf(store),
    editorCapabilities: capabilities(),
  }).skills.find((skill) => skill.id === 'timeline.editor');
  if (!editor) throw new Error('No timeline.editor skill');
  const skills = [defineSkillModule({ id: 'timeline', skills: [editor as AnySkill] })];

  await seed(bus, store, editTimeline());
  return {
    bus,
    store,
    modules,
    skills,
    projectId: PROJECT_ID,
    timelineId: TIMELINE_ID,
    comments,
    batches: createCommentBatches({ store: comments, timelines: store, bus }),
    timeline: () => store.read(TIMELINE_ID),
  };
}

async function seed(bus: CommandBus, store: EvalTimelineStore, timeline: Timeline) {
  const run = async (name: string, payload: Record<string, unknown>) => {
    const done = await bus.dispatch(name, payload, UI);
    if (!done.ok) throw new Error(`${name}: ${done.error.code} ${done.error.detail ?? ''}`);
  };
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  await run('timeline.create', { projectId: timeline.projectId, timelines: [timeline] });
  await run('captions.rebuild', target);
  // One lower third on from 1 s, for the graphics cases that change or take one off (seed-graphic.ts): the
  // Designer's to place, so written as the next revision, as placing it would.
  const latest = store.read(timeline.id);
  const placed = await store.put(
    { ...withLowerThird(latest), revision: latest.revision + 1 },
    latest.revision,
  );
  if (!placed.ok) throw new Error(`seed: ${placed.error.code}`);
}
