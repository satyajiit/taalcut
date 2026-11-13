// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/timeline in the agent process: the `timelines` namespace, the
 * timeline and music commands, the `timeline` tools and the Librarian and
 * Editor skills, over the library's TimelineStore and TemplateStore and the
 * casting engine (agent-casting.ts: the library's shot profiles and the
 * active embedding space). Swaps and applyCast read the same catalogue;
 * choosing the user's own track (music path b) re-times the cuts to the beats
 * audio's tracker finds in it, run as a job in the jobs process.
 *
 * Render's `timeline.captureFrame` shares the module id, so the agent offers
 * one `timeline` module with both packages' tools.
 *
 * Phase 3: pro export (P3-V5) through the registered writers, the library's
 * originals (InterchangeMediaSource) and the exports folder (agent-interchange.ts);
 * talking-head cleanup plans (P3-V9) from audio's speech analysis; a Style on one
 * or many timelines (P3-V16); variants' music axis (P3-V3); the energy curve (P3-V12),
 * with @taalcut/templates' applyEnergyCurve and template versioning once the template
 * store is there. Each is served once its owner registers the port, and answers
 * core.not_implemented until then.
 *
 * REF1: the reel's own music needs no acknowledgement. Assembly makes it a new
 * cut's music when the template keeps its reel with sound (the template reader
 * asks core's TemplateMediaStore once it is registered), and choosing it puts
 * the cuts back on the template's beats after an own track moved them.
 */
import { createTranscriptRepository } from '@taalcut/library';
import {
  ClockToken,
  CommandBusToken,
  defineToolModule,
  err,
  EventBusToken,
  ExportFileSinkToken,
  InterchangeMediaSourceToken,
  NotFoundError,
  NotImplementedError,
  SubjectSourceToken,
  WorkspaceStoreToken,
  type AssetId,
  type ProjectId,
  type SubjectSource,
  notServedRouter,
  ok,
  SettingsStoreToken,
  SpeechCleanupSourceToken,
  StyleStoreToken,
  TemplateMediaStoreToken,
  TemplateStoreToken,
  TimelineStoreToken,
  timelinesContract,
  timelinesRouter,
  UnknownError,
  type Container,
  type SkillModule,
  type Token,
  type ToolModule,
} from '@taalcut/core';
import { shotDescriptions } from '@taalcut/library';
import { applyEnergyCurve, createTemplateService } from '@taalcut/templates';
import {
  createTimelineCommands,
  createPrepareNarration,
  createTimelineService,
  defaultExporterRegistry,
  storeTemplateReader,
  timelineSkillModule,
  timelineToolModule,
  clipNumberingOf,
  type EnergyDeps,
  type InterchangeDeps,
  type FrameSizes,
  type ShotDescriptions,
  type TemplateReader,
  type TimelineService,
  type TimelineServiceDeps,
  type VariantMusicDeps,
} from '@taalcut/timeline';
import { LibraryDatabaseToken, ToolRegistryToken } from '../../shared/tokens';
import { CastingEngineToken, registerCasting, ShotCatalogToken } from './agent-casting';
import { TemplateFitterToken } from './agent-template-index';
import { registerExportFileSink } from './agent-interchange';
import { libraryBeatTracker } from './agent-track-beats';
import { narrationAssets } from './timeline-narration';
import { editSubjects } from './edit-subjects';
import { canGenerate } from './agent-audio-services';
import { TemplateDesignTrackerToken } from './template-design-tracker';
import { makerDoneOf } from './match-ports';

export function registerTimelineAgent(container: Container): void {
  registerCasting(container);
  registerExportFileSink(container);
}

/** The service registered under `token`, or null when no root registered one. */
function registered<T>(container: Container, token: Token<T>): T | null {
  return container.has(token) ? container.resolve(token) : null;
}

/**
 * Template versions over the library's store, and whether each keeps its reel with sound (REF1): from the template
 * media store when this process has one, else the summary's `media`.
 */
function templateReader(container: Container): TemplateReader {
  const store = container.resolve(TemplateStoreToken);
  const media = registered(container, TemplateMediaStoreToken);
  return media ? storeTemplateReader(store, media) : storeTemplateReader(store);
}

/** Audio's speech analyses and the app's cleanup defaults, once audio registers its source (P3-V9). */
function cleanupReads(container: Container): TimelineServiceDeps['cleanup'] | null {
  const speech = registered(container, SpeechCleanupSourceToken);
  if (!speech) return null;
  const settings = registered(container, SettingsStoreToken);
  return settings ? { speech, settings } : { speech };
}

/** The writers, the library's originals and the exports folder; null until the library serves the originals. */
function interchange(container: Container): InterchangeDeps | null {
  if (!container.has(InterchangeMediaSourceToken) || !container.has(ExportFileSinkToken)) return null;
  return {
    exporters: defaultExporterRegistry(),
    media: container.resolve(InterchangeMediaSourceToken),
    files: container.resolve(ExportFileSinkToken),
  };
}

/** The template half of the energy curve and its versioning (P3-V12), once the template store is there. */
function energyDeps(container: Container): EnergyDeps | null {
  const store = registered(container, TemplateStoreToken);
  if (!store) return null;
  const templates = createTemplateService({ store, clock: container.resolve(ClockToken) });
  return { applyCurve: applyEnergyCurve, templates, reader: storeTemplateReader(store) };
}

/**
 * The timelines service; "find something else" and the energy curve's plan once casting and the templates are
 * there, the export formats always, and cleanup plans once audio's analysis is.
 */
function service(container: Container): TimelineService {
  const cleanup = cleanupReads(container);
  const templates = registered(container, TemplateStoreToken);
  return createTimelineService({
    transcripts: async (assetId) =>
      ok(createTranscriptRepository(container.resolve(LibraryDatabaseToken)).get(assetId)),
    store: container.resolve(TimelineStoreToken),
    events: container.resolve(EventBusToken),
    exporters: defaultExporterRegistry(),
    ...(container.has(CastingEngineToken) ? { engine: container.resolve(CastingEngineToken) } : {}),
    ...(templates ? { templates: storeTemplateReader(templates), applyEnergyCurve } : {}),
    ...(cleanup ? { cleanup } : {}),
    // timelines.fitTemplates (LRN1-TPL).
    ...(container.has(TemplateFitterToken) ? { fit: container.resolve(TemplateFitterToken) } : {}),
  });
}

export function timelinesNamespace(
  container: Container,
): ReturnType<typeof notServedRouter<typeof timelinesContract>> {
  if (!container.has(TimelineStoreToken)) return notServedRouter(timelinesContract, 'timelines');
  return timelinesRouter(service(container));
}

export function registerTimelineCommands(container: Container): void {
  if (!container.has(TimelineStoreToken)) return;
  const proExport = interchange(container);
  const energy = energyDeps(container);
  const templates = container.has(TemplateStoreToken) ? templateReader(container) : null;
  const commands = createTimelineCommands({
    narration: narrationAssets(container),
    transcripts: async (assetId) =>
      ok(createTranscriptRepository(container.resolve(LibraryDatabaseToken)).get(assetId)),
    store: container.resolve(TimelineStoreToken),
    events: container.resolve(EventBusToken),
    clock: container.resolve(ClockToken),
    ...(container.has(ShotCatalogToken) ? { catalog: container.resolve(ShotCatalogToken) } : {}),
    ...(container.has(LibraryDatabaseToken) ? { trackBeats: libraryBeatTracker(container) } : {}),
    // The reel's beat map, which choosing the reel's music puts the cuts back on (REF1).
    ...(templates ? { templates } : {}),
    // The energy curve's undo moves the template's head back.
    ...(container.has(TemplateStoreToken) ? { templateStore: container.resolve(TemplateStoreToken) } : {}),
    ...(energy ? { energy } : {}),
    ...(proExport ? { interchange: proExport } : {}),
    ...(container.has(StyleStoreToken) ? { styles: container.resolve(StyleStoreToken) } : {}),
    // FRM1-OVL: a swap, a recast or new words place the overlays again with the clips' people.
    subjects: editSubjects(container),
  });
  const bus = container.resolve(CommandBusToken);
  const recorder = createPrepareNarration({
    timelines: container.resolve(TimelineStoreToken),
    events: container.resolve(EventBusToken),
  });
  bus.register(...commands.all, recorder.command);
  // `library.changed` for each committed timeline command (never before its writes commit).
  commands.announce(bus);
}

/**
 * Variants' music axis (P3-V3): an own track's beats so the cuts follow it; null without the library. The reel's
 * music needs nothing here since REF1: its beat map comes from the template reader.
 */
function variantMusic(container: Container): VariantMusicDeps | null {
  return container.has(LibraryDatabaseToken) ? { trackBeats: libraryBeatTracker(container) } : null;
}

/** One `timeline` module: the timeline package's tools and render's (captureFrame). */
export function timelineAgentToolModule(
  container: Container,
  renderTools: ToolModule | undefined,
): ToolModule {
  const music = variantMusic(container);
  const own = timelineToolModule({
    engine: container.resolve(CastingEngineToken),
    service: service(container),
    templates: templateReader(container),
    clock: container.resolve(ClockToken),
    ...(music ? { music } : {}),
    // timeline.fitTemplates (LRN1-TPL).
    ...(container.has(TemplateFitterToken) ? { fit: container.resolve(TemplateFitterToken) } : {}),
    // timeline.cast's rerank list: what indexing said each candidate shows (FIX-LIBRARIAN).
    ...(container.has(LibraryDatabaseToken) ? { shotDescriptions: libraryShotDescriptions(container) } : {}),
    // FRM1-SUB: every pick's subject track before the first draft, and the clips' sizes for reframing.
    subjects: lazySubjects(container),
    frameSizes: libraryFrameSizes(container),
    // EDT1-OPS: the clips' numbering, shared with the audio module's sound edits (agent-audio.ts) through the store.
    numbering: clipNumberingOf(container.resolve(TimelineStoreToken)),
    // HFW1: a template's composition files go into the project when a make draws with them.
    workspace: lazyWorkspace(container),
    // FIX-GFXWAIT: a make from a template whose graphics are being designed waits for them.
    ...(container.has(TemplateDesignTrackerToken)
      ? { graphicsReady: container.resolve(TemplateDesignTrackerToken).wait }
      : {}),
  });
  const recorder = createPrepareNarration({
    timelines: container.resolve(TimelineStoreToken),
    events: container.resolve(EventBusToken),
  });
  return defineToolModule({
    id: own.id,
    tools: [...own.tools, ...(renderTools?.tools ?? []), ...recorder.tools.tools],
  });
}

/** The library's workspace store, read when assembly asks (registered after the tools in some roots). */
function lazyWorkspace(container: Container) {
  const missing = () => err(NotImplementedError({ feature: 'workspace' }));
  return {
    putBlob: (projectId: ProjectId, data: Uint8Array) =>
      container.has(WorkspaceStoreToken)
        ? container.resolve(WorkspaceStoreToken).putBlob(projectId, data)
        : Promise.resolve(missing()),
    readTemplateBlob: (sha256: string) => {
      const store = container.has(WorkspaceStoreToken) ? container.resolve(WorkspaceStoreToken) : undefined;
      return store?.readTemplateBlob ? store.readTemplateBlob(sha256) : Promise.resolve(missing());
    },
  };
}

/** The subject source render's root registers (render-phase3-agent.ts), read when assembly asks. */
function lazySubjects(container: Container): SubjectSource {
  return {
    over: (clip, signal) =>
      container.has(SubjectSourceToken)
        ? container.resolve(SubjectSourceToken).over(clip, signal)
        : Promise.resolve(ok(undefined)),
    ensure: (ranges, signal) =>
      container.has(SubjectSourceToken)
        ? container.resolve(SubjectSourceToken).ensure(ranges, signal)
        : Promise.resolve(err(NotFoundError({ entity: 'subjectSource' }))),
  };
}

/**
 * Each asset's upright size from the library, for assembly's reframe: the stored size, swapped when the asset is
 * rotated a quarter turn (a phone's portrait clip is often stored landscape with a 90° rotation).
 */
function libraryFrameSizes(container: Container): FrameSizes {
  return async (assetIds) => {
    if (assetIds.length === 0 || !container.has(LibraryDatabaseToken)) return ok(new Map());
    try {
      const rows = container
        .resolve(LibraryDatabaseToken)
        .driver.prepare(
          `SELECT id, width, height, rotation_degrees FROM assets
           WHERE id IN (SELECT value FROM json_each(?)) AND width > 0 AND height > 0`,
        )
        .all(JSON.stringify(assetIds));
      const sizes = new Map<AssetId, { width: number; height: number }>();
      for (const row of rows) {
        const turned = row.rotation_degrees === 90 || row.rotation_degrees === 270;
        const width = Number(turned ? row.height : row.width);
        const height = Number(turned ? row.width : row.height);
        sizes.set(String(row.id) as AssetId, { width, height });
      }
      return ok(sizes);
    } catch (cause) {
      return err(UnknownError(undefined, { detail: `frame sizes: ${String(cause).slice(0, 200)}` }));
    }
  };
}

/** The library's stored shot descriptions; a read that fails leaves the cast without a rerank list. */
function libraryShotDescriptions(container: Container): ShotDescriptions {
  return async (shotIds) => {
    try {
      return ok(shotDescriptions(container.resolve(LibraryDatabaseToken), shotIds));
    } catch (cause) {
      return err(UnknownError(undefined, { detail: `shot descriptions: ${String(cause).slice(0, 200)}` }));
    }
  };
}

import { editorCapabilities } from './editor-capabilities';

export function timelineAgentSkills(container: Container): SkillModule {
  return timelineSkillModule({
    service: service(container),
    templates: storeTemplateReader(container.resolve(TemplateStoreToken)),
    // EDT1-OPS: the Editor asked in the chat may use music, effects and voice where they are offered (agent-audio.ts).
    editorCapabilities: editorCapabilities(registeredTools(container)),
    editorFamilies: canGenerate(container) ? ['music', 'sfx', 'voice'] : [],
    // EDT1-OPS: the clips' numbering the tools share, for the Editor's check (a docked run that never read the timeline).
    numbering: clipNumberingOf(container.resolve(TimelineStoreToken)),
    // AGT2: the Maker makes the video in the flows, over the tools registered here (the other lanes' join by name).
    maker: makerDeps(container),
  });
}

/** AGT2: the Maker over the registered tools, its handoff held to video.done's verdict (match-ports.ts). */
function makerDeps(container: Container) {
  const done = makerDoneOf(container);
  const extendedTools = !process.env.TAALCUT_TEST_RECORDED_MODELS;
  return { registered: registeredTools(container), extendedTools, ...(done ? { done } : {}) };
}

/** Whether a tool is registered in this process (the Maker lists only those). */
function registeredTools(container: Container): (tool: string) => boolean {
  const tools = container.resolve(ToolRegistryToken);
  return (tool) => tools.describe(tool) !== undefined;
}
