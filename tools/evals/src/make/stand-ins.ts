// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's tools that live outside timeline and render, as stand-ins over the made-up library:
 * library.search (shots whose words share the query's, with the camera move indexing measured), and graphics.design
 * as the job and the Designer together: eval:design scores the Designer, so here a job is done as asked and at once.
 * A job for graphics already there puts them where the Designer is held to the reel's; a new one draws the reel's
 * graphic that comes on nearest its time and isn't drawn yet, there. Names and inputs are the real tools'.
 */
import { z } from 'zod';
import {
  defineTool,
  graphicsDesignJobSchema,
  NO_TOOL_RETRY,
  ok,
  RationalTime,
  ulidSchema,
  ValidationError,
  err,
  type AnyTool,
  type GraphicItem,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { DESIGN_CANVAS, expectedPlace, overlayBrief } from '@taalcut/render';
import type { EvalTimelineStore } from '../edit/world';
import { idCounter } from '../edit/ids';
import { BUBBLE } from './draft-doc';

const LOCAL = { network: 'none' } as const;

/** render's graphics.design input: the job, on a timeline. */
const designInput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  ...graphicsDesignJobSchema.shape,
});

/** A shot library.search can find: its words, and its camera move as indexing measured it. */
export interface SearchShot {
  readonly shotId: string;
  readonly assetId: string;
  readonly seconds: number;
  readonly description: string;
  readonly tags: readonly string[];
  readonly motion: string;
}

function scoreOf(entry: SearchShot, query: string): number {
  const words = (query.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  const haystack = `${entry.description} ${entry.tags.join(' ')}`.toLowerCase();
  return words.filter((word) => haystack.includes(word.replace(/s$/, ''))).length / words.length;
}

export function makeLibrarySearch(shots: readonly SearchShot[]): AnyTool {
  return defineTool({
    name: 'library.search',
    version: '1.1.0',
    description:
      "Searches the user's footage by meaning and keywords, in any of the app's languages: what is seen " +
      '(the frames), the descriptions, what is said and on-screen text. Returns shots with their file, ' +
      'start and length, why each matched, and a 0..1 score for ordering.',
    summary: "Finds shots in the user's footage by meaning and keywords.",
    tags: ['search', 'footage', 'shots', 'find'],
    input: z.object({
      query: z.string().trim().min(1).max(500).describe('What to look for, e.g. "sunset shots on the beach"'),
      limit: z.int().min(1).max(30).default(12),
    }),
    output: z.object({
      hits: z.array(
        z.object({
          shotId: ulidSchema('Shot'),
          assetId: ulidSchema('Asset'),
          seconds: z.number(),
          description: z.string(),
          motion: z.string(),
          score: z.number(),
        }),
      ),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    run: async (input) =>
      ok({
        hits: shots
          .map((entry) => ({ entry, score: scoreOf(entry, input.query) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, input.limit)
          .map(({ entry, score }) => ({
            shotId: entry.shotId,
            assetId: entry.assetId,
            seconds: entry.seconds,
            description: entry.description,
            motion: entry.motion,
            score: Math.round(score * 1000) / 1000,
          })),
      }),
  }) as AnyTool;
}

const graphicsOf = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item): item is GraphicItem => item.type === 'graphic') : [],
  );

/**
 * A reel graphic as a graphic, when the reel draws it and where the Designer is held to (render's expectedPlace: the
 * reel's place, grown to the type floor), so render's reelMatch passes it.
 */
function reelGraphic(
  template: Template,
  overlay: Template['text'][number],
  id: GraphicItem['id'],
): GraphicItem {
  const brief = overlayBrief(template, overlay);
  const place = brief ? expectedPlace(brief) : null;
  const box = place
    ? {
        x: place.left / DESIGN_CANVAS.width,
        y: place.top / DESIGN_CANVAS.height,
        width: place.width / DESIGN_CANVAS.width,
        height: place.height / DESIGN_CANVAS.height,
      }
    : (overlay.design?.shape ?? overlay.box);
  return {
    type: 'graphic',
    id,
    anchor: { kind: 'time', at: overlay.start },
    start: overlay.start,
    duration: overlay.duration,
    placement: { box },
    styleKey: 'graphic',
    language: template.language,
    origin: 'agent',
    overlay: { id: overlay.id, words: 'template' },
    composition: { id: BUBBLE.id, hash: BUBBLE.hash, params: { text: overlay.text } },
  };
}

const span = (item: { start: RationalTime; duration: RationalTime }) => {
  const from = RationalTime.toSeconds(item.start);
  return [from, from + RationalTime.toSeconds(item.duration)] as const;
};

/** Each graphic on the first text track it overlaps nothing on, else on a new one (T1, T2…), as placing does. */
function withGraphics(tracks: Timeline['tracks'], graphics: readonly GraphicItem[]): Timeline['tracks'] {
  const out = [...tracks];
  for (const graphic of graphics) {
    const [from, to] = span(graphic);
    const free = out.findIndex(
      (track) =>
        track.kind === 'text' &&
        track.items.every((item) => {
          const [start, end] = span(item);
          return end <= from || start >= to;
        }),
    );
    const track = out[free];
    if (track?.kind === 'text') {
      const items = [...track.items, graphic].sort((a, b) => span(a)[0] - span(b)[0]);
      out[free] = { ...track, items };
      continue;
    }
    const n = out.filter((entry) => entry.kind === 'text').length + 1;
    out.push({ kind: 'text', id: `T${n}`, name: 'Graphics', enabled: true, items: [graphic] });
  }
  return out;
}

export interface DesignJobs {
  readonly asked: z.output<typeof designInput>[];
}

export function makeDesignStandIn(
  store: EvalTimelineStore,
  template: Template,
): { tool: AnyTool; jobs: DesignJobs } {
  const jobs: DesignJobs = { asked: [] };
  const newId = idCounter<'TimelineItem'>('01K9MN');
  const tool = defineTool({
    name: 'graphics.design',
    version: '1.0.0',
    description:
      'Asks the Designer for a graphic: any NEW graphic (a title, a lower third, chat messages, a map pin, a ' +
      'countdown, a sticker, a chart) and any change to how one LOOKS or where it sits as the reel has it. ' +
      'request says what, in words. A change to graphics already there names them in itemIds (graphics.list); a ' +
      'new one says when with at (seconds from the start). Moving, resizing, retiming or rewording one is ' +
      'graphics.edit.',
    summary: 'Asks the Designer for a new graphic or a new look for one.',
    tags: ['graphics', 'graphic', 'design', 'create', 'add', 'new', 'look', 'bubble', 'reel'],
    input: designInput,
    output: z.object({ itemIds: z.array(z.string()), note: z.string() }),
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    run: async (input) => {
      jobs.asked.push(input);
      const timeline = store.read(input.timelineId);
      const placed = graphicsOf(timeline);
      const overlays = template.text.filter((overlay) => overlay.design);
      let changed: GraphicItem[];
      if (input.itemIds) {
        changed = placed.flatMap((item) => {
          if (!input.itemIds!.includes(item.id)) return [];
          const overlay = overlays.find((entry) => entry.id === item.overlay?.id);
          return overlay
            ? [{ ...reelGraphic(template, overlay, item.id), composition: item.composition }]
            : [];
        });
        if (changed.length === 0)
          return err(
            ValidationError({ field: 'itemIds' }, { detail: 'None of those graphics draws a reel graphic' }),
          );
      } else {
        const drawn = new Set(placed.flatMap((item) => (item.overlay ? [item.overlay.id] : [])));
        const at = input.at ?? 0;
        const free = overlays
          .filter((overlay) => !drawn.has(overlay.id))
          .sort(
            (a, b) =>
              Math.abs(RationalTime.toSeconds(a.start) - at) - Math.abs(RationalTime.toSeconds(b.start) - at),
          );
        if (!free[0])
          return err(ValidationError({ field: 'at' }, { detail: 'Every reel graphic is drawn already' }));
        changed = [reelGraphic(template, free[0], newId())];
      }
      const ids = new Set(changed.map((item) => item.id));
      const kept = timeline.tracks.map((track) =>
        track.kind === 'text' ? { ...track, items: track.items.filter((item) => !ids.has(item.id)) } : track,
      );
      const tracks = withGraphics(kept, changed);
      const next = { ...timeline, tracks, revision: timeline.revision + 1 } as Timeline;
      const put = await store.put(next, timeline.revision);
      if (!put.ok) return put;
      return ok({
        itemIds: [...ids],
        note: `Designed and placed as the reel has it; the timeline is now revision ${next.revision}.`,
      });
    },
  }) as AnyTool;
  return { tool, jobs };
}
