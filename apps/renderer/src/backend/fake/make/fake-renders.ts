// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `appContract.renders` and the render commands as the fake serves them
 * (P2-M8, P2-M11): renders in every state, one export running at a time
 * through the export stages to its QA verdict (a tick every `tickMs`; 0
 * holds everything still), Notify me, the project's export settings, Export
 * anyway, soft delete with Undo, export options, and preview sessions whose
 * URLs live under app://preview (the browser's stand-in viewer paints them).
 */
import {
  defineCommand,
  err,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  RENDER_COMMANDS,
  renderCommandPayloads,
  type AnyCommand,
  type CardOf,
  type EventBus,
  type ExportOptions,
  type ExportPresetId,
  type ExportVideoCodec,
  type ProjectId,
  type RenderId,
  type RenderSnapshot,
  type TemplateId,
  type TimelineId,
} from '@taalcut/core';
import { watched } from '../watch';
import type { FakeTimelines } from './fake-timelines';
import type { IdMaker } from './ids';
import { codecRefusal, exportOptionsFor, previewSessions, type ReelOf } from './export-options';
import { presetName, renderSnapshot } from './render-snapshot';
import { bytesOf, presetOf, qaReport, summaryOf, WARNED } from './render-data';
import { preflightFailure, type WarpedMusicCache } from './render-preflight';
import { trackFlowRender, type StoredRender } from './render-track';
import { PRESETS } from './render-presets';
import type { SeededRender } from './render-seed';

type RenderCaptions = RenderSnapshot['captions'];

const STAGES = [
  'preflight',
  'conforming',
  'composing',
  'capturing',
  'mixingAudio',
  'finishing',
  'checking',
] as const;
const base = { sideEffect: 'write' as const, project: (p: { projectId: ProjectId }) => p.projectId };

export interface FakeRendersInput {
  readonly timelines: FakeTimelines;
  readonly ids: IdMaker;
  readonly projectName: (projectId: ProjectId) => string;
  /** REF1: what the timeline's template keeps of its reel (its music, link and sound). */
  readonly reelOf: (templateId: TemplateId) => ReelOf | null;
  /** An export keeps the revision it rendered as a timeline version. */
  readonly exported: (timelineId: TimelineId, label: string) => void;
  /** Milliseconds between progress ticks; 0 holds every render still. */
  readonly tickMs: number;
  /** The library key of a timeline's first frame, for posters. */
  readonly posterKey: (timelineId: TimelineId) => string | null;
  /** The media cache's warped music: a generated-music export without its file stops at preflight. */
  readonly warpedMusic: WarpedMusicCache;
  /** LNX1-AV1: the codecs the fake machine encodes (FAKE_VIDEO_CODECS); the Mac's without. */
  readonly videoCodecs?: readonly ExportVideoCodec[];
}

type Stored = StoredRender;

export function createFakeRenders(
  events: EventBus,
  input: FakeRendersInput,
  seeded: readonly SeededRender[],
) {
  const renders = new Map<RenderId, Stored>(
    seeded.map(({ snapshot, report }) => [snapshot.id, { snapshot, report }]),
  );
  const settings = new Map<
    ProjectId,
    { presetId: ExportPresetId; codec?: ExportVideoCodec; captions: RenderCaptions; includeBumpers: boolean }
  >();
  const machine = input.videoCodecs ?? ['h264', 'hevc'];
  const list = watched(() => [...renders.values()].map((stored) => stored.snapshot));
  const previews = previewSessions(input.timelines, input.ids);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const changed = (stored: Stored) => {
    list.notify();
    events.emit('library.changed', {
      projectId: stored.snapshot.projectId,
      entity: 'render',
      change: 'updated',
      ids: [stored.snapshot.id],
    });
  };
  const patch = (stored: Stored, next: Partial<RenderSnapshot>) => {
    const before = stored.snapshot.status;
    stored.snapshot = { ...stored.snapshot, ...next };
    // Progress reaches windows through renders.watch; library.changed is for what a list shows (status, notify…).
    if (
      Object.keys(next).every((key) => key === 'progress' || key === 'status') &&
      before === stored.snapshot.status
    )
      list.notify();
    else changed(stored);
  };
  const finish = (stored: Stored, status: 'ready' | 'needsAttention' | 'failed' | 'cancelled') => {
    patch(stored, {
      status,
      progress: status === 'ready' ? { fraction: 1 } : stored.snapshot.progress,
      finishedAt: Date.now(),
    });
    const { snapshot } = stored;
    events.emit('render.finished', {
      renderId: snapshot.id,
      projectId: snapshot.projectId,
      status,
      notify: snapshot.notify,
      name: snapshot.name,
    });
  };
  const running = () =>
    [...renders.values()].find((stored) =>
      ['rendering', 'checking', 'fixing'].includes(stored.snapshot.status),
    );

  function tick() {
    timer = null;
    const current =
      running() ?? [...renders.values()].reverse().find((stored) => stored.snapshot.status === 'queued');
    if (!current) return;
    if (current.failure) {
      patch(current, { error: current.failure });
      finish(current, 'failed');
      return schedule();
    }
    const fraction = Math.min(1, (current.snapshot.progress?.fraction ?? 0) + 0.035);
    const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(fraction * STAGES.length))]!;
    const seconds = current.snapshot.durationFrames / 30;
    if (fraction >= 1) {
      current.report = qaReport(current.snapshot.id, current.snapshot.presetId, WARNED, Date.now());
      patch(current, {
        qa: summaryOf(current.report),
        bytes: bytesOf(current.snapshot.presetId, seconds),
      });
      finish(current, 'ready');
    } else {
      patch(current, {
        status: stage === 'checking' ? 'checking' : 'rendering',
        progress: {
          fraction,
          stageKey: `render.stage.${stage}`,
          etaMs: Math.round((1 - fraction) * seconds * 1100),
        },
      });
    }
    schedule();
  }
  function schedule() {
    if (timer || input.tickMs <= 0) return;
    const busy = running() ?? [...renders.values()].some((stored) => stored.snapshot.status === 'queued');
    if (busy) timer = setTimeout(tick, input.tickMs);
  }
  const find = (renderId: RenderId) => renders.get(renderId);
  const missing = (id: string) => err(NotFoundError({ entity: 'render', id }));

  const commands: AnyCommand[] = [
    defineCommand({
      ...base,
      name: RENDER_COMMANDS.export,
      payload: renderCommandPayloads[RENDER_COMMANDS.export],
      handle: (p) => {
        const timeline = input.timelines.get(p.timelineId);
        if (!timeline) return err(NotFoundError({ entity: 'timeline', id: p.timelineId }));
        // As the real command: a preset the engine doesn't render is refused before anything is queued.
        const preset = presetOf(p.presetId);
        if (!preset.ok) return preset;
        const refused = codecRefusal(preset.value, p.codec, machine);
        if (refused) return err(refused);
        const revision = p.timelineRevision ?? timeline.revision;
        const same = [...renders.values()].find(
          ({ snapshot }) =>
            snapshot.timelineId === p.timelineId &&
            snapshot.timelineRevision === revision &&
            snapshot.presetId === p.presetId &&
            snapshot.deletedAt === null &&
            ['queued', 'rendering', 'checking', 'ready'].includes(snapshot.status),
        );
        if (same) return ok({ result: { renderId: same.snapshot.id, jobId: same.snapshot.jobId } });
        const name = p.name ?? `${input.projectName(p.projectId)} – ${presetName(p.presetId)}`;
        input.exported(p.timelineId, name);
        const snapshot = renderSnapshot(timeline, {
          id: input.ids.render(),
          projectId: p.projectId,
          timelineRevision: revision,
          presetId: p.presetId,
          status: 'queued',
          jobId: input.ids.job(),
          name,
          captions: p.captions,
          supersedes: p.supersedes ?? null,
          notify: p.notify,
          // P3-V16: a batch's render says which batch it is in, as render.exportBatch's renders do.
          batchId: p.batchId ?? null,
        });
        const failure = preflightFailure(
          timeline,
          input.warpedMusic,
          (id) => input.reelOf(id)?.music ?? false,
        );
        const stored: Stored = { snapshot, report: null, ...(failure ? { failure } : {}) };
        renders.set(snapshot.id, stored);
        changed(stored);
        schedule();
        return ok({ result: { renderId: snapshot.id, jobId: snapshot.jobId } });
      },
    }),
    defineCommand({
      ...base,
      name: RENDER_COMMANDS.cancel,
      payload: renderCommandPayloads[RENDER_COMMANDS.cancel],
      handle: (p) => {
        const stored = find(p.renderId);
        if (!stored) return missing(p.renderId);
        if (['queued', 'rendering', 'checking', 'fixing'].includes(stored.snapshot.status))
          finish(stored, 'cancelled');
        return ok({ result: { renderId: p.renderId, status: stored.snapshot.status } });
      },
    }),
    defineCommand({
      ...base,
      name: RENDER_COMMANDS.setNotify,
      payload: renderCommandPayloads[RENDER_COMMANDS.setNotify],
      handle: (p) => {
        const stored = find(p.renderId);
        if (!stored) return missing(p.renderId);
        const before = stored.snapshot.notify;
        if (before === p.notify) return ok({ result: null });
        patch(stored, { notify: p.notify });
        return ok({
          result: null,
          inverse: { name: RENDER_COMMANDS.setNotify, payload: { ...p, notify: before } },
        });
      },
    }),
    defineCommand({
      ...base,
      name: RENDER_COMMANDS.setExportPreset,
      payload: renderCommandPayloads[RENDER_COMMANDS.setExportPreset],
      handle: (p) => {
        // As the real handler (contract review P3-1, finding 13): an unbuilt preset is never saved, and the
        // Style's bumpers choice is kept with the preset.
        const built = presetOf(p.presetId);
        if (!built.ok) return built;
        // LNX1-AV1, as the real one: a codec the preset offers; without one, the kept codec while it still offers it.
        const offered = built.value.video.codecs ?? [built.value.video.codec];
        if (p.codec && !offered.includes(p.codec)) return err(codecRefusal(built.value, p.codec, machine)!);
        const before = settings.get(p.projectId) ?? {
          presetId: 'reels' as const,
          captions: { burnIn: true, sidecars: [] },
          includeBumpers: true,
        };
        const codec = p.codec ?? (before.codec && offered.includes(before.codec) ? before.codec : undefined);
        settings.set(p.projectId, {
          presetId: p.presetId,
          ...(codec ? { codec } : {}),
          captions: p.captions ?? before.captions,
          includeBumpers: p.includeBumpers ?? before.includeBumpers,
        });
        return ok({
          result: null,
          inverse: { name: RENDER_COMMANDS.setExportPreset, payload: { projectId: p.projectId, ...before } },
        });
      },
    }),
    defineCommand({
      ...base,
      name: RENDER_COMMANDS.overrideQa,
      payload: renderCommandPayloads[RENDER_COMMANDS.overrideQa],
      sources: PERSON_SOURCES,
      handle: (p) => {
        const stored = find(p.renderId);
        if (!stored?.report) return missing(p.renderId);
        const failing = stored.report.checks.filter((check) => check.status === 'fail');
        if (failing.some((check) => !check.overridable || !p.checks.includes(check.id)))
          return err({
            code: 'render.override_refused',
            messageKey: 'errors.render.override_refused',
            retryable: false,
          });
        stored.report = {
          ...stored.report,
          verdict: 'overridden',
          overrides: p.checks.map((check) => ({ check, at: Date.now(), actor: 'user' })),
        };
        patch(stored, { qa: summaryOf(stored.report) });
        finish(stored, 'ready');
        return ok({ result: { renderId: p.renderId } });
      },
    }),
    ...(
      [
        [RENDER_COMMANDS.delete, RENDER_COMMANDS.restore, true],
        [RENDER_COMMANDS.restore, RENDER_COMMANDS.delete, false],
      ] as const
    ).map(([name, inverse, gone]) =>
      defineCommand({
        ...base,
        name,
        payload: renderCommandPayloads[name],
        ...(gone ? {} : { internal: true }),
        handle: (p) => {
          const stored = find(p.renderId);
          if (!stored) return missing(p.renderId);
          patch(stored, { deletedAt: gone ? Date.now() : null });
          return ok({
            result: null,
            inverse: { name: inverse, payload: { projectId: p.projectId, renderId: p.renderId } },
          });
        },
      }),
    ),
  ];

  const visible = (projectId?: ProjectId) =>
    [...renders.values()]
      .map((stored) => stored.snapshot)
      .filter((snapshot) => snapshot.deletedAt === null && (!projectId || snapshot.projectId === projectId))
      .sort((a, b) => b.createdAt - a.createdAt);

  return {
    commands,
    start: schedule,
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    count: (projectId: ProjectId) => visible(projectId).length,
    presets: () => [...PRESETS],
    list: (projectId?: ProjectId, limit = 500) => visible(projectId).slice(0, limit),
    get: (renderId: RenderId) => find(renderId)?.snapshot ?? null,
    /** A render the scripted chat flow announces in its renderProgress cards (render-track.ts). */
    track: (card: CardOf<'renderProgress'>) =>
      trackFlowRender(card, {
        find,
        patch,
        add: (stored) => {
          renders.set(stored.snapshot.id, stored);
          changed(stored);
        },
        timelines: input.timelines,
        projectName: input.projectName,
      }),
    async *watch(projectId?: ProjectId, signal?: AbortSignal) {
      schedule();
      for await (const _ of list.stream(signal)) yield visible(projectId);
    },
    qaReport: (renderId: RenderId) => find(renderId)?.report ?? null,
    /** app://preview URLs: the poster carries its frame's key so the browser's stand-in can paint it. */
    mediaUrl(renderId: RenderId, kind: 'video' | 'poster' | 'frame') {
      const stored = find(renderId);
      if (!stored) return null;
      if (kind === 'video') return `app://preview/fake/render/${renderId}.mp4`;
      const key = input.posterKey(stored.snapshot.timelineId);
      return key ? `app://preview/fake/${key}` : null;
    },
    exportOptions(projectId: ProjectId, timelineId: TimelineId): ExportOptions | null {
      const timeline = input.timelines.get(timelineId);
      return timeline
        ? exportOptionsFor(
            projectId,
            timeline,
            settings.get(projectId)?.presetId,
            timeline.template ? input.reelOf(timeline.template.id) : null,
            machine,
          )
        : null;
    },
    ...previews,
  };
}

export type FakeRenders = ReturnType<typeof createFakeRenders>;
export { presetOf };
