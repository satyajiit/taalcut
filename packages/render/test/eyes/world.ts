// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes tests: a made-up reel and draft (lavfi patterns, 3 s, portrait), a two-slot template whose intents say
 * what each slot needs, a timeline made from it with one clip per slot, and the draft's render record.
 */
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { join } from 'node:path';
import {
  err,
  FrameRates,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  type RenderRecord,
  type SlotId,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { EyesDeps } from '../../src/eyes/deps';
import { ffmpeg } from '../support/media';
import { makeTimeline } from '../support/timeline';

const rate = FrameRates.fps30;
const at = (frames: number) => RationalTime.of(frames, rate);

/** Two 45-frame slots: the first a close-up with its face hidden and a need, the second a wide one. */
export function madeUpTemplate(): Template {
  const slot = (index: number, intent: Partial<Template['slots'][number]['intent']>) => ({
    id: newId<'TemplateSlot'>() as SlotId,
    name: null,
    role: index === 0 ? ('hook' as const) : ('outro' as const),
    start: at(index * 45),
    duration: at(45),
    intent: {
      text: `made-up intent ${index + 1}`,
      shotType: null,
      motion: null,
      subject: null,
      people: null,
      place: null,
      energy: 0.5,
      source: 'analyst' as const,
      ...intent,
    },
    beatAnchor: null,
    transitionIn: null,
    speedRamp: null,
    cut: { method: 'both' as const, confidence: 1 },
    approved: false,
    frame: null,
  });
  return {
    id: newId<'Template'>(),
    version: 1,
    canvas: { width: 1080, height: 1920, rate },
    duration: at(90),
    slots: [
      slot(0, { shotType: 'close', needs: ['a made-up prop in hand'], face: 'hidden' }),
      slot(1, { shotType: 'wide', face: 'shown' }),
    ],
  } as unknown as Template;
}

/** A timeline from the template: one 45-frame clip per slot. */
export function madeUpTimeline(template: Template): Timeline {
  const base = makeTimeline({ items: [{ frames: 45 }, { frames: 45 }] } as never);
  const [video, ...rest] = base.tracks;
  if (video?.kind !== 'video') throw new Error('no V1');
  let index = 0;
  const items = video.items.map((item) =>
    item.type === 'clip' ? { ...item, slotId: template.slots[index++]!.id } : item,
  );
  return {
    ...base,
    template: { id: template.id, version: template.version },
    tracks: [{ ...video, items }, ...rest],
  } as Timeline;
}

export function draftRecord(
  timeline: Timeline,
  filePath: string,
  revision = timeline.revision,
): RenderRecord {
  return {
    id: newId<'Render'>(),
    projectId: timeline.projectId,
    timelineId: timeline.id,
    timelineRevision: revision,
    status: 'ready',
    filePath,
    durationFrames: 90,
    rate,
    createdAt: 1,
    deletedAt: null,
  } as unknown as RenderRecord;
}

/** The reel (a test pattern) and the draft (bars), 3 s each, 360x640. */
export async function madeUpFiles(ctx: MediaContext, dir: string) {
  const reel = join(dir, 'reel.mp4');
  const draft = join(dir, 'draft.mp4');
  for (const [source, out] of [
    ['testsrc2=s=360x640:r=30:d=3', reel],
    ['smptebars=s=360x640:r=30:d=3', draft],
  ] as const)
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      source,
      '-pix_fmt',
      'yuv420p',
      ...softwareH264FixtureFlags(),
      out,
    ]);
  return { reel, draft };
}

export function eyesDeps(input: {
  readonly media: MediaContext | null;
  readonly scratch: string;
  readonly template: Template;
  readonly timeline: Timeline;
  readonly renders: readonly RenderRecord[];
  readonly reel: string | null;
  readonly overrides?: Partial<EyesDeps>;
}): EyesDeps {
  return {
    timelines: { get: async () => ok(input.timeline), atRevision: async () => ok(input.timeline) },
    templates: { read: async () => ok(input.template) },
    renders: {
      list: async () => ok(input.renders),
      get: async (id) => {
        const found = input.renders.find((render) => render.id === id);
        return found ? ok(found) : err(NotFoundError({ entity: 'render', id }));
      },
    },
    reel: async () => input.reel,
    media: async () => input.media,
    scratch: input.scratch,
    assets: { original: async () => ok(null) },
    subjects: { over: async () => ok(undefined), ensure: async () => ok(undefined) },
    ...input.overrides,
  };
}
