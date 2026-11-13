// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a finished export was made from (LRN1-MEM, "what worked"): the render, its timeline's template version and
 * Style, and the choices that reached the file (the preset, the transitions, captions, music). Read from core's
 * stores. A render that isn't ready, was made without a template, or whose template or timeline has since been
 * deleted has no facts (ok(undefined)); a store that can't be read is an error, passed on.
 */
import {
  ok,
  upgradeTimeline,
  type AsyncResult,
  type ExportPresetId,
  type MusicPath,
  type RenderId,
  type RenderRecord,
  type Result,
  type StoredTemplateVersion,
  type StoredTimeline,
  type Style,
  type StyleId,
  type TemplateId,
  type TimelineId,
} from '@taalcut/core';

export interface RenderFacts {
  readonly renderId: RenderId;
  /** When the render finished, epoch ms. */
  readonly finishedAt: number;
  readonly templateId: TemplateId;
  readonly templateName: string;
  readonly templateVersion: number;
  readonly styleId: StyleId | null;
  readonly styleName: string | null;
  readonly presetId: ExportPresetId;
  readonly music: MusicPath;
  readonly captions: boolean;
  readonly clips: number;
  readonly seconds: number;
  /** Transition kinds the edit used, the most used first; empty for straight cuts. */
  readonly transitions: readonly string[];
}

/** What the facts read of a render: core's RenderStore gives more. */
export type RenderFactsRecord = Pick<
  RenderRecord,
  'status' | 'timelineId' | 'rate' | 'durationFrames' | 'presetId' | 'music' | 'createdAt' | 'finishedAt'
>;

/** The stores the facts read, as narrow as they are used; core's stores fit them. */
export interface RenderFactsDeps {
  readonly renders: { get(id: RenderId): AsyncResult<RenderFactsRecord> };
  readonly timelines: { get(id: TimelineId): AsyncResult<Pick<StoredTimeline, 'json' | 'schemaVersion'>> };
  readonly templates: {
    get(
      id: TemplateId,
      version?: number,
    ): AsyncResult<{ readonly summary: Pick<StoredTemplateVersion['summary'], 'name'> }>;
  };
  readonly styles?: { get(id: StyleId): AsyncResult<Pick<Style, 'name'>> };
}

/** A read whose "not found" means the thing is gone: ok(undefined). Any other failure stays an error. */
async function present<T>(read: AsyncResult<T>): AsyncResult<T | undefined> {
  const result: Result<T> = await read;
  if (result.ok || result.error.code !== 'core.not_found') return result;
  return ok(undefined);
}

/** The finished render's facts, or undefined when it has none (see the module comment). */
export async function renderFacts(
  deps: RenderFactsDeps,
  renderId: RenderId,
): AsyncResult<RenderFacts | undefined> {
  const render = await present(deps.renders.get(renderId));
  if (!render.ok || render.value?.status !== 'ready') return render.ok ? ok(undefined) : render;
  const stored = await present(deps.timelines.get(render.value.timelineId));
  if (!stored.ok || !stored.value) return stored.ok ? ok(undefined) : stored;
  const upgraded = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
  if (!upgraded.ok) return upgraded;
  const timeline = upgraded.value;
  const ref = timeline.template;
  if (!ref) return ok(undefined);
  const template = await present(deps.templates.get(ref.id, ref.version));
  if (!template.ok || !template.value) return template.ok ? ok(undefined) : template;
  const style =
    timeline.styleId && deps.styles ? await present(deps.styles.get(timeline.styleId)) : ok(undefined);
  if (!style.ok) return style;
  const used = new Map<string, number>();
  let clips = 0;
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue;
    for (const item of track.items) {
      if (item.type === 'clip') clips++;
      if (item.type === 'transition') used.set(item.kind, (used.get(item.kind) ?? 0) + 1);
    }
  }
  const { rate, finishedAt, createdAt, presetId, music, durationFrames } = render.value;
  const fps = rate.num / Math.max(1, rate.den);
  return ok({
    renderId,
    finishedAt: finishedAt ?? createdAt,
    templateId: ref.id,
    templateName: template.value.summary.name,
    templateVersion: ref.version,
    styleId: timeline.styleId,
    styleName: style.value?.name ?? null,
    presetId,
    music,
    captions: timeline.captions !== null,
    clips,
    seconds: fps > 0 ? Math.round(durationFrames / fps) : 0,
    transitions: [...used].sort((a, b) => b[1] - a[1]).map(([kind]) => kind),
  });
}
