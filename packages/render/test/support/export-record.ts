// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A queued render row for the Phase 3 export suites (brand, credentials, reframe, graphics, stills): the request
 * render.export would store, with the options each suite turns, the export run to its end over the test engine,
 * and what its QA report says.
 */
import {
  newId,
  unwrap,
  type ExportPresetId,
  type ExportRequest,
  type RenderRecord,
  type Timeline,
} from '@taalcut/core';
import { runExport } from '../../src/engine/export-run';
import { createLiveRenders } from '../../src/engine/live';
import { presetFor } from '../../src/presets/presets.v1';
import { resolveExportRequest } from '../../src/commands/request';
import type { TestEngine } from './engine';

export interface RenderOptions {
  readonly presetId?: ExportPresetId;
  readonly rate?: ExportRequest['rate'];
  readonly contentCredentials?: boolean;
  readonly includeBumpers?: boolean;
  readonly burnCaptions?: boolean;
  /** Sidecar subtitle files next to the export (none by default). */
  readonly sidecars?: ExportRequest['captions']['sidecars'];
  /** Whether render.finished asks for a notification (off by default). */
  readonly notify?: boolean;
}

export async function queueRender(
  engine: TestEngine,
  timeline: Timeline,
  options: RenderOptions = {},
): Promise<RenderRecord> {
  const presetId = options.presetId ?? 'device';
  const preset = presetFor(presetId);
  const request: ExportRequest = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    timelineRevision: timeline.revision,
    presetId,
    captions: { burnIn: options.burnCaptions ?? true, sidecars: options.sidecars ?? [] },
    notify: options.notify ?? false,
    contentCredentials: { add: options.contentCredentials ?? false },
    includeBumpers: options.includeBumpers ?? true,
    ...(options.rate ? { rate: options.rate } : {}),
  };
  engine.timelines.set(timeline.id, timeline);
  const created = await engine.store.create({
    id: newId<'Render'>(),
    projectId: timeline.projectId,
    timelineId: timeline.id,
    timelineRevision: timeline.revision,
    presetId,
    status: 'queued',
    jobId: null,
    name: `${timeline.name} – ${presetId}`,
    width: preset.width,
    height: preset.height,
    rate: options.rate ?? timeline.canvas.rate,
    durationFrames: options.rate ? unwrap(resolveExportRequest(request, timeline)).frames : 0,
    bytes: null,
    music: timeline.music.path,
    captions: request.captions,
    qa: null,
    supersedes: null,
    notify: request.notify,
    error: null,
    credentials: { added: false, state: null },
    batchId: null,
    createdAt: Date.now(),
    finishedAt: null,
    deletedAt: null,
    request,
    filePath: null,
    compositionHash: null,
    qaReport: null,
    requestKey: newId<'Render'>(),
  });
  if (!created.ok) throw new Error(created.error.code);
  return created.value;
}

/** Runs the export to its end and returns the stored row (throws on an export error, with its code). */
export async function exportToEnd(engine: TestEngine, record: RenderRecord): Promise<RenderRecord> {
  const result = await runExport(engine.deps, createLiveRenders(), {
    renderId: record.id,
    request: record.request,
  });
  if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
  const stored = await engine.store.get(record.id);
  if (!stored.ok) throw new Error(stored.error.code);
  return stored.value;
}

/** A check's status in a stored row's QA report ('missing' when it isn't in the report). */
export function checkStatus(record: RenderRecord, id: string): string {
  return record.qaReport?.checks.find((check) => check.id === id)?.status ?? 'missing';
}

/**
 * The ids of the checks that failed (a render that should deliver lists none), with what they measured and the
 * fixes they offer (which tell a fault the render made from one the footage has).
 */
export function failing(record: RenderRecord): string[] {
  return (record.qaReport?.checks ?? [])
    .filter((check) => check.status === 'fail')
    .map(
      (check) =>
        `${check.id} ${JSON.stringify(check.measured ?? null)} ${JSON.stringify(check.findings)} ${JSON.stringify(check.fixes)}`,
    );
}
