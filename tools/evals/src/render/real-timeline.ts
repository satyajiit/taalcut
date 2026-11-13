// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A render golden as core's Timeline v1: one video clip per golden clip
 * (its source from real-sources.ts, cover fit, its click sound kept), each
 * anchored on the beat it starts on; the golden's beats as the beat map;
 * overlays as text items below the strip; captions as a caption track, each
 * cue lasting until the next (or two seconds). A golden transition renders
 * as a plain cut: the strip check reads every frame, and render's own
 * goldens cover transition blends.
 */
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type AssetId,
  type CaptionTrack,
  type Timeline,
} from '@taalcut/core';
import { durationFrames, type RenderGolden } from './schema';

const CUE_FRAMES = 60;

export function goldenTimeline(
  golden: RenderGolden,
  sources: readonly { readonly assetId: AssetId; readonly frames: number }[],
): Timeline {
  const rate = FrameRate.of(golden.frameRate.numerator, golden.frameRate.denominator);
  const at = (frames: number) => RationalTime.of(frames, rate);
  const span = (start: number, frames: number) => ({ start: at(start), duration: at(frames) });
  const total = durationFrames(golden);
  const beatIndex = new Map(golden.beats.map((beat, index) => [beat, index]));
  let start = 0;
  const clips = golden.clips.map((clip, index) => {
    const source = sources[index]!;
    const item = {
      type: 'clip' as const,
      id: newId<'TimelineItem'>(),
      media: {
        kind: 'video' as const,
        assetId: source.assetId,
        shotId: null,
        available: span(0, source.frames),
      },
      sourceStart: at(clip.inFrame),
      duration: at(clip.frames),
      speed: null,
      slotId: null,
      syncPoint: null,
      beatAnchor: beatIndex.has(start) ? { beatIndex: beatIndex.get(start)!, offset: at(0) } : null,
      fit: 'cover' as const,
      audio: { gainDb: 0, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    };
    start += clip.frames;
    return item;
  });
  const texts = golden.overlays.map((overlay) => ({
    type: 'text' as const,
    id: newId<'TimelineItem'>(),
    start: at(overlay.startFrame),
    duration: at(Math.min(CUE_FRAMES, total - overlay.startFrame)),
    text: overlay.text,
    role: 'title' as const,
    slotId: null,
    overlayId: null,
    box: { x: 0.1, y: 0.35, width: 0.8, height: 0.1 },
    appearance: { size: 0.04, align: 'center' as const, case: 'mixed' as const, background: 'none' as const },
    styleKey: 'title',
    reveal: 'none' as const,
    language: overlay.language,
    origin: 'editor' as const,
  }));
  const timeline = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: golden.id,
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: {
      rate: FrameRate.of(1000),
      beats: golden.beats.map((beat) => RationalTime.rescale(at(beat), FrameRate.of(1000), 'round')),
      downbeats: [],
      bpm: null,
      beatsPerBar: null,
      confidence: 1,
      source: 'user',
    },
    tracks: [
      { kind: 'video', id: 'V1', name: 'Video', enabled: true, items: clips },
      ...(texts.length > 0 ? [{ kind: 'text', id: 'T1', name: 'Text', enabled: true, items: texts }] : []),
    ],
    markers: [],
    cast: null,
    captions: captionsOf(golden, total, at, span),
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  };
  return timelineSchema.parse(timeline);
}

function captionsOf(
  golden: RenderGolden,
  total: number,
  at: (frames: number) => RationalTime,
  span: (start: number, frames: number) => { start: RationalTime; duration: RationalTime },
): CaptionTrack | null {
  const first = golden.captions[0];
  if (!first) return null;
  const sorted = [...golden.captions].sort((a, b) => a.startFrame - b.startFrame);
  return {
    enabled: true,
    language: first.language,
    styleSource: 'preset',
    style: {
      version: 1,
      font: 'notoSans',
      weight: 700,
      sizePx: 72,
      textColor: '#ffffff',
      highlightColor: '#ffd400',
      stroke: { color: '#000000', widthPx: 4 },
      background: null,
      highlight: 'none',
      letterCase: 'asIs',
      anchorY: 0.58,
      maxLines: 2,
      maxWords: 6,
    },
    cues: sorted.map((caption, index) => {
      const end = Math.min(total, sorted[index + 1]?.startFrame ?? caption.startFrame + CUE_FRAMES);
      const frames = Math.max(1, end - caption.startFrame);
      const words = caption.text.split(/\s+/).filter(Boolean);
      const each = Math.max(1, Math.floor(frames / words.length));
      return {
        id: newId<'CaptionCue'>(),
        range: span(caption.startFrame, frames),
        words: words.map((word, wordIndex) => {
          const wordStart = caption.startFrame + wordIndex * each;
          const wordFrames = wordIndex === words.length - 1 ? caption.startFrame + frames - wordStart : each;
          return {
            text: word,
            range: { start: at(wordStart), duration: at(Math.max(1, wordFrames)) },
            confidence: 1,
          };
        }),
        edited: false,
      };
    }),
  };
}
