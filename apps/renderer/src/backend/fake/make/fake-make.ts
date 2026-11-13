// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Make namespaces the renderer's fake serves (P2-M3, P2-M7, P2-M8,
 * P2-M11, P2-X3): `projects`, `timelines` and `renders`, each core's
 * contract, plus every command they change things with, registered on the
 * fake's bus. Golden hour market's first variant has a history: the user
 * swapped slot 4 after the first cut, exported it to Reels, and kept on.
 */
import {
  appContract,
  implementContract,
  NotFoundError,
  NotImplementedError,
  toRpcError,
  type AnyCommand,
  type EventBus,
  type RenderSnapshot,
  type TaalcutError,
  type TemplateId,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { swapClip } from './edits';
import { createFakeBatch } from './p3/fake-batch';
import { createFakeCleanup } from './p3/fake-cleanup';
import { createFakeEnergy } from './p3/fake-energy';
import { createFakeGaps } from './p3/fake-gaps';
import { createFakeInterchange } from './p3/fake-interchange';
import { exportState } from './p3/interchange/export-state';
import { createFakeFit } from './fake-fit';
import { createFakeProjects } from './fake-projects';
import { FAKE_VIDEO_CODECS, reelOf, withReelMusic } from './export-options';
import { createFakeRenders } from './fake-renders';
import { createFakeCaptionEdit } from './fake-caption-edit';
import { createFakeEditorOps } from './fake-editor-ops';
import { createFakeTimelines } from './fake-timelines';
import type { FakeTemplates } from '../templates/fake-templates';
import { GOLDEN_TIMELINES, idMaker } from './ids';
import { seedRenders } from './render-seed';
import type { FakeMakeOptions } from './make-options';
import { seedProjects } from './seed';

export type { FakeMakeOptions } from './make-options';

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const rpc = (error: TaalcutError) => toRpcError(error);

/** Variant 1 after the user's swap of slot 4 (a "You changed this" on the board), at revision 7. */
function withHistory(timeline: Timeline, shots: ReturnType<typeof seedProjects>['shots']): Timeline {
  const slot = timeline.cast?.slots[3];
  const alternate = slot?.alternates[0];
  if (!slot?.clipId || !alternate) return timeline;
  const swapped = swapClip(
    timeline,
    { clipId: slot.clipId, shot: shots.get(alternate.shotId ?? alternate.assetId) },
    'ui',
  );
  return swapped.ok ? { ...swapped.timeline, revision: 7 } : timeline;
}

/** LRN1-STY: my exports' set, as the library finds it: the templates behind a ready export's timeline. */
function exportedTemplatesOf(
  renders: { list: () => readonly RenderSnapshot[] },
  timelines: { get: (id: TimelineId) => Timeline | undefined },
): TemplateId[] {
  const ids = new Set<TemplateId>();
  for (const render of renders.list()) {
    const template = render.status === 'ready' ? timelines.get(render.timelineId)?.template : null;
    if (template) ids.add(template.id);
  }
  return [...ids];
}

export function createMakeFakes(events: EventBus, options: FakeMakeOptions = {}, templates: FakeTemplates) {
  const ids = idMaker();
  // Nothing made from an empty library: the projects need its footage.
  const empty = options.empty === true || options.libraryCount === 0;
  const seeded: ReturnType<typeof seedProjects> = empty
    ? { projects: [], shots: new Map(), pools: new Map<TimelineId, never[]>() }
    : seedProjects(options.libraryCount, options.areas);
  const projectsSeed = empty
    ? []
    : seeded.projects.map((project) => ({
        ...project,
        timelines: project.timelines.map((timeline) =>
          timeline.id === GOLDEN_TIMELINES[0] ? withHistory(timeline, seeded.shots) : timeline,
        ),
      }));
  const reel = (templateId: TemplateId) => reelOf(templates, templateId);
  const timelines = createFakeTimelines(events, {
    // REF1: a video made from a template that keeps its reel's music has it by default.
    timelines: projectsSeed.flatMap((project) => project.timelines.map((each) => withReelMusic(each, reel))),
    shots: seeded.shots,
    pools: seeded.pools,
  });
  // The cut as it was first made: the early versions keep it.
  const history = empty ? { renders: [], versions: [] } : seedRenders(seeded.projects);
  // Versions seeded before the history keep variant 1 as it was cut; the later ones see the swap.
  const versions = history.versions.map((version, index) => {
    const live = timelines.get(version.timelineId);
    return live && index >= 2 ? { ...version, snapshot: live } : version;
  });
  const names = new Map(projectsSeed.map((project) => [project.id, project.name]));
  let projects: ReturnType<typeof createFakeProjects> | null = null;
  const renders = createFakeRenders(
    events,
    {
      timelines,
      ids,
      projectName: (id) => projects?.get(id)?.name ?? names.get(id) ?? '',
      reelOf: reel,
      exported: (timelineId, label) => projects?.exported(timelineId, label),
      tickMs: options.renderTickMs ?? 600,
      videoCodecs: FAKE_VIDEO_CODECS[options.system ?? 'mac'],
      warpedMusic: (key) => exportState().warpedMusic.has(key),
      posterKey: (timelineId) => {
        const first = timelines.get(timelineId)?.tracks[0]?.items.find((item) => item.type === 'clip');
        const shot =
          first?.type === 'clip' && first.media.kind === 'video'
            ? seeded.shots.get(first.media.shotId ?? first.media.assetId)
            : undefined;
        return shot?.thumbnail.key ?? null;
      },
    },
    history.renders.map((render) =>
      render.snapshot.timelineId === GOLDEN_TIMELINES[0]
        ? { ...render, snapshot: { ...render.snapshot, timelineRevision: 5 } }
        : render,
    ),
  );
  projects = createFakeProjects(
    events,
    { projects: projectsSeed, timelines, shots: seeded.shots, ids, renderCount: renders.count },
    versions,
  );
  const made = projects;
  const latency = options.latencyMs ?? 0;
  // Phase 3 (ui-make): each module serves its own procedures and commands.
  const p3Deps = { events, timelines, renders, projects: made, shots: seeded.shots, ids, templates, options };
  const p3 = {
    energy: createFakeEnergy(p3Deps),
    cleanup: createFakeCleanup(p3Deps),
    gaps: createFakeGaps(p3Deps),
    interchange: createFakeInterchange(p3Deps),
    batch: createFakeBatch(p3Deps),
    fit: createFakeFit(p3Deps),
  };

  const pr = implementContract(appContract.projects);
  const tl = implementContract(appContract.timelines);
  const rn = implementContract(appContract.renders);
  const router = {
    projects: pr.router({
      list: pr.list.handler(async ({ input }) => {
        await wait(latency);
        return made.list(input.archived, input.limit);
      }),
      get: pr.get.handler(async ({ input }) => {
        await wait(latency);
        const found = made.get(input.projectId);
        if (!found) throw rpc(NotFoundError({ entity: 'project', id: input.projectId }));
        return found;
      }),
      versions: pr.versions.handler(async ({ input }) => {
        await wait(latency);
        return made.versions(input.timelineId, input.limit);
      }),
    }),
    timelines: tl.router({
      transcript: tl.transcript.handler(({ input }) => {
        const found = timelines.get(input.timelineId);
        if (!found) throw rpc(NotFoundError({ entity: 'timeline', id: input.timelineId }));
        return { timelineId: found.id, revision: found.revision, words: [] };
      }),
      listByProject: tl.listByProject.handler(async ({ input }) => {
        await wait(latency);
        return timelines.listByProject(input.projectId);
      }),
      get: tl.get.handler(async ({ input }) => {
        await wait(latency);
        const found = timelines.get(input.timelineId);
        if (!found) throw rpc(NotFoundError({ entity: 'timeline', id: input.timelineId }));
        return found;
      }),
      watch: tl.watch.handler(async function* ({ input, signal }) {
        await wait(latency);
        if (!timelines.get(input.timelineId))
          throw rpc(NotFoundError({ entity: 'timeline', id: input.timelineId }));
        yield* timelines.watch(input.timelineId, signal);
      }),
      findAlternates: tl.findAlternates.handler(async ({ input }) => {
        await wait(latency + 250);
        return timelines.findAlternates(input);
      }),
      ...p3.interchange.router,
      ...p3.gaps.router,
      ...p3.cleanup.router,
      ...p3.energy.router,
      ...p3.fit.router,
    }),
    renders: rn.router({
      coverImage: rn.coverImage.handler(() => {
        throw rpc(NotImplementedError({ feature: 'cover.preview' }));
      }),
      presets: rn.presets.handler(() => renders.presets()),
      exportOptions: rn.exportOptions.handler(async ({ input }) => {
        await wait(latency);
        const found = renders.exportOptions(input.projectId, input.timelineId);
        if (!found) throw rpc(NotFoundError({ entity: 'timeline', id: input.timelineId }));
        return found;
      }),
      list: rn.list.handler(async ({ input }) => {
        await wait(latency);
        return renders.list(input.projectId, input.limit);
      }),
      get: rn.get.handler(({ input }) => {
        const found = renders.get(input.renderId);
        if (!found) throw rpc(NotFoundError({ entity: 'render', id: input.renderId }));
        return found;
      }),
      watch: rn.watch.handler(async function* ({ input, signal }) {
        await wait(latency);
        yield* renders.watch(input.projectId, signal);
      }),
      ...p3.batch.router,
      qaReport: rn.qaReport.handler(({ input }) => {
        const found = renders.qaReport(input.renderId);
        if (!found) throw rpc(NotFoundError({ entity: 'qaReport', id: input.renderId }));
        return found;
      }),
      mediaUrl: rn.mediaUrl.handler(({ input }) => {
        const url = renders.mediaUrl(input.renderId, input.kind);
        if (!url) throw rpc(NotFoundError({ entity: 'render', id: input.renderId }));
        return { url };
      }),
      openPreview: rn.openPreview.handler(async ({ input }) => {
        await wait(latency);
        const session = renders.openPreview(input.projectId, input.timelineId);
        if (!session) throw rpc(NotFoundError({ entity: 'timeline', id: input.timelineId }));
        return session;
      }),
      refreshPreview: rn.refreshPreview.handler(({ input }) => {
        const session = renders.refreshPreview(input.sessionId);
        if (!session)
          throw rpc({
            code: 'render.preview_session_expired',
            messageKey: 'errors.render.preview_session_expired',
            retryable: true,
          });
        return session;
      }),
      closePreview: rn.closePreview.handler(({ input }) => renders.closePreview(input.sessionId)),
      subtitles: rn.subtitles.handler(({ input }) => {
        const timeline = timelines.get(input.timelineId);
        const cues = timeline?.captions?.cues ?? [];
        const stamp = (frames: number) => {
          const ms = Math.round((frames / 30) * 1000);
          const pad = (n: number, w = 2) => String(n).padStart(w, '0');
          return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${input.format === 'srt' ? ',' : '.'}${pad(ms % 1000, 3)}`;
        };
        const body = cues
          .map((cue, index) => {
            const start = cue.range.start.value;
            const end = start + cue.range.duration.value;
            const line = `${stamp(start)} --> ${stamp(end)}\n${cue.words.map((word) => word.text).join(' ')}`;
            return input.format === 'srt' ? `${index + 1}\n${line}` : line;
          })
          .join('\n\n');
        return {
          fileName: `${(timeline?.name ?? 'captions').replace(/[^\w -]+/g, '')}.${input.format}`,
          text: input.format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`,
        };
      }),
    }),
  };

  const commands: AnyCommand[] = [
    ...timelines.commands,
    // EDT1-OPS: split, delete, speed, transitions, colour and sound levels.
    ...createFakeEditorOps(timelines),
    createFakeCaptionEdit(timelines),
    ...projects.commands,
    ...renders.commands,
    ...Object.values(p3).flatMap((module) => module.commands),
  ];
  const exportedTemplates = () => exportedTemplatesOf(renders, timelines);
  return { router, commands, timelines, renders, projects: made, p3, exportedTemplates };
}

export type FakeMake = ReturnType<typeof createMakeFakes>;
