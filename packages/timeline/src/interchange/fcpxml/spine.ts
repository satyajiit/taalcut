// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FCPXML spine (P3-V5): V1 in order, a video clip as an `<asset-clip>` (offset = its place on the timeline,
 * start = its in-point in the asset's time, duration = its length, all exact), a still as a `<video>` of the
 * image asset, a gap as a `<gap>`; with each item its speed, its gain, the audio connected below it and its
 * markers. A clip whose own sound is muted takes only its picture (`srcEnable="video"`).
 */
import type { Clip, Timeline } from '@taalcut/core';
import { positions, sequenceLength, videoItems, type Position } from '../../model/sequence';
import { add, framesToSeconds, subtract, timeToSeconds, ZERO, type Seconds } from '../seconds';
import { assetOf, type FcpResources } from './resources';
import { timeMap } from './retime';
import type { ConnectedAudio, TimedMarker } from './story-items';
import { fcpTime } from './time';
import { element, type XmlNode } from './xml';

const decibels = (gain: number) => `${Number.isInteger(gain) ? gain : gain.toFixed(1)}dB`;

/** Where a timeline frame falls: the item it starts in (the last item for the very end). */
function owner(all: readonly Position[], frame: number): Position | null {
  return all.find((position) => frame >= position.start && frame < position.end) ?? all.at(-1) ?? null;
}

/** The local time of an item's first frame: a clip's in-point, else zero. */
function localStart(item: Position['item']): Seconds {
  return item.type === 'clip' && item.media.kind === 'video' ? timeToSeconds(item.sourceStart) : ZERO;
}

function audioNode(
  audio: ConnectedAudio,
  parent: Position,
  local: Seconds,
  timeline: Timeline,
  resources: FcpResources,
) {
  const rate = timeline.canvas.rate;
  const asset = assetOf(resources, audio.assetId);
  const offset = add(local, framesToSeconds(audio.at - parent.start, rate));
  return element(
    'asset-clip',
    {
      ref: asset.id,
      lane: String(audio.lane),
      offset: fcpTime(offset),
      start: fcpTime(audio.inPoint),
      duration: fcpTime(framesToSeconds(audio.frames, rate)),
      enabled: audio.enabled ? null : '0',
      srcEnable: asset.kind === 'video' ? 'audio' : null,
      audioRole: audio.role,
    },
    audio.gainDb !== 0 ? [element('adjust-volume', { amount: decibels(audio.gainDb) })] : [],
  );
}

function markerNode(marker: TimedMarker, parent: Position, local: Seconds, timeline: Timeline): XmlNode {
  const rate = timeline.canvas.rate;
  const into = Math.min(Math.max(marker.at - parent.start, 0), parent.end - parent.start - 1);
  return element('marker', {
    start: fcpTime(add(local, framesToSeconds(into, rate))),
    duration: fcpTime(framesToSeconds(1, rate)),
    value: marker.value,
    note: marker.note,
  });
}

function clipAttrs(clip: Clip, resources: FcpResources) {
  const asset = assetOf(resources, clip.media.assetId);
  const audible = clip.media.kind === 'video' && asset.hasAudio && !clip.audio.muted;
  return { asset, audible };
}

export function buildSpine(
  timeline: Timeline,
  resources: FcpResources,
  markers: readonly TimedMarker[],
  audio: readonly ConnectedAudio[],
): XmlNode {
  const rate = timeline.canvas.rate;
  const all = positions(videoItems(timeline));
  const children = all.map((position) => {
    const { item } = position;
    const local = localStart(item);
    const anchored = audio
      .filter((entry) => owner(all, entry.at) === position)
      .map((entry) => audioNode(entry, position, local, timeline, resources));
    const marks = markers
      .filter((entry) => owner(all, entry.at) === position)
      .map((entry) => markerNode(entry, position, local, timeline));
    const common = {
      offset: fcpTime(framesToSeconds(position.start, rate)),
      duration: fcpTime(framesToSeconds(position.end - position.start, rate)),
    };
    if (item.type === 'gap' || item.type === 'program')
      return element('gap', { offset: common.offset, start: fcpTime(ZERO), duration: common.duration }, [
        ...anchored,
        ...marks,
      ]);
    const { asset, audible } = clipAttrs(item, resources);
    const retime = timeMap(item, local);
    const volume =
      audible && item.audio.gainDb !== 0
        ? [element('adjust-volume', { amount: decibels(item.audio.gainDb) })]
        : [];
    const attrs = {
      ref: asset.id,
      offset: common.offset,
      start: fcpTime(local),
      duration: common.duration,
      enabled: item.enabled ? null : '0',
    };
    if (item.media.kind === 'image')
      return element('video', attrs, [...(retime ? [retime] : []), ...anchored, ...marks]);
    return element(
      'asset-clip',
      {
        ...attrs,
        srcEnable: audible ? null : 'video',
        tcFormat: 'NDF',
        audioRole: audible ? 'dialogue' : null,
      },
      [...(retime ? [retime] : []), ...volume, ...anchored, ...marks],
    );
  });
  return element('spine', {}, children);
}

/** The sequence's length: V1's. */
export const sequenceDuration = (timeline: Timeline): string =>
  fcpTime(framesToSeconds(sequenceLength(videoItems(timeline)), timeline.canvas.rate));

/** For read-back: an item's timeline offset minus its local start, so a child's local time maps to the timeline. */
export const toTimeline = (offset: Seconds, local: Seconds, child: Seconds): Seconds =>
  add(offset, subtract(child, local));
