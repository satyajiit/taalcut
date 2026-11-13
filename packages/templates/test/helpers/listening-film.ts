// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1 fixture films (tools/earshot-parity, EAR1-F2) as templates: one slot per shot of the film, the listening the
 * breakdown keeps built from upstream earshot's own sync of the film's cuts (`timeline --video`), and a video made
 * from the template (one clip per slot), so the reel's effects can be followed onto it.
 */
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  templateSchema,
  timelineSchema,
  type CutSyncStatus,
  type SequenceItem,
  type Template,
  type Timeline,
} from '@taalcut/core';
import {
  buildAudioProfile,
  computePacing,
  reelListening,
  slotListening,
  BREAKDOWN_CONFIG,
} from '../../src/index';
import { clip, cliRun } from '../../../../tools/earshot-parity/fixtures.mjs';
import { intent, referenceTemplate } from './fixtures';
import { plannedListening, type CutPlan } from './listening-fakes';

interface UpstreamItem {
  readonly t: number;
  readonly status: string;
  readonly offset_ms: number | null;
  readonly event?: string;
}

const STATUS: Readonly<Record<string, CutSyncStatus>> = {
  OK: 'ok',
  near: 'near',
  swell: 'swell',
  peak: 'peak',
  off: 'off',
  'no sound': 'none',
};

export interface Film {
  readonly id: string;
  readonly rate: FrameRate;
  readonly frames: number;
  /** The film's cuts, frames. */
  readonly cuts: readonly number[];
  /** Upstream's status for each cut, in order. */
  readonly statuses: readonly CutSyncStatus[];
  readonly upstream: readonly UpstreamItem[];
}

export function film(id: string): Film {
  const row = clip(id);
  const fps = Number(row.truth.fps);
  const cuts = (row.truth.cuts ?? []).map((t) => Math.round(t * fps));
  const upstream = (cliRun<{ sync: { cuts: { items: UpstreamItem[] } } }>('timeline', id).sync.cuts.items ??
    []) as UpstreamItem[];
  return {
    id,
    rate: FrameRate.of(fps),
    frames: Number(row.truth.frames),
    cuts,
    statuses: upstream.map((item) => STATUS[item.status] ?? 'none'),
    upstream,
  };
}

/** What answered each cut upstream: an onset or a swell at its offset (a swell's a long build: a riser). */
function upstreamPlan(item: UpstreamItem | undefined): CutPlan {
  const status = item ? (STATUS[item.status] ?? 'none') : 'none';
  if (!item || item.offset_ms === null || status === 'none') return { status: 'none' };
  return {
    status,
    offsetMs: item.offset_ms,
    event:
      status === 'swell'
        ? { shape: 'swell', riseMs: 900 }
        : { band: /boom|thud|drop/.test(item.event ?? '') ? 'low' : 'full' },
  };
}

/** The film as a reference template: a slot per shot, its listening under the slots. */
export function filmTemplate(source: Film): Template {
  const base = referenceTemplate();
  const at = (frame: number) => RationalTime.of(frame, source.rate);
  const starts = [0, ...source.cuts];
  const slots = starts.map((start, index) => ({
    ...base.slots[1]!,
    id: newId<'TemplateSlot'>(),
    name: null,
    role: index === 0 ? ('hook' as const) : ('body' as const),
    start: at(start),
    duration: at((starts[index + 1] ?? source.frames) - start),
    intent: intent(`shot ${index + 1}`),
    beatAnchor: null,
    transitionIn: null,
    speedRamp: null,
    frame: null,
  }));
  const heard = plannedListening(source.cuts.map(at), (index) => upstreamPlan(source.upstream[index]), {
    seconds: source.frames / source.rate.num,
  });
  const listening = slotListening(reelListening(heard, source.cuts, source.rate)!, starts, source.rate);
  return templateSchema.parse({
    ...base,
    canvas: { ...base.canvas, rate: source.rate },
    duration: at(source.frames),
    slots,
    beatMap: null,
    text: [],
    contactSheet: null,
    pacing: computePacing(slots, null, source.rate),
    audio: {
      ...buildAudioProfile({
        integratedLufs: -16,
        beatMap: null,
        speech: null,
        peaks: null,
        sound: null,
        durationMs: (source.frames * 1000) / source.rate.num,
        config: BREAKDOWN_CONFIG.audio,
      }),
      listening,
    },
  });
}

/** A video made from the template: one clip per slot, its length. */
export function madeTimeline(template: Template): Timeline {
  const rate = template.canvas.rate;
  const items: SequenceItem[] = template.slots.map((slot) => ({
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'video',
      assetId: newId<'Asset'>(),
      shotId: null,
      available: {
        start: RationalTime.of(0, rate),
        duration: RationalTime.of(slot.duration.value + 60, rate),
      },
    },
    sourceStart: RationalTime.of(0, rate),
    duration: RationalTime.of(slot.duration.value, rate),
    speed: null,
    slotId: slot.id,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  }));
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Made from the reel',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: { id: template.id, version: template.version },
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  });
}
