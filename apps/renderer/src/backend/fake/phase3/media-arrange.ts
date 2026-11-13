// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The media cards' timelines (P3-B6, P3-V13, P3-B7), for /dev/kit and the media cards' end-to-end test: the
 * kit's voiceover, motion graphic and image takes fixtures point at the Golden hour timelines, and with the fake's
 * media option (`media: { arranged: true }`) each one gets what its cards show: the voiceover with its clips on a
 * voice track (A2), the graphics on a text track of their own (T2), drawn with made-up compositions (records only,
 * in `graphicCompositions`: the fake draws nothing), the image slot as the placed still or, with nothing placed, a
 * gap. Pure: the document in, the arranged document out.
 */
import {
  RationalTime,
  timelineSchema,
  type CardOf,
  type Clip,
  type GraphicComposition,
  type GraphicItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { CARD_FIXTURES, GRAPHIC_FIXTURE_DESIGNS, MEDIA_FIXTURE_IDS } from '@taalcut/ui';

type AudioTrack = Extract<Track, { kind: 'audio' }>;
type VideoTrack = Extract<Track, { kind: 'video' }>;
type SequenceItem = VideoTrack['items'][number];

/** A made-up hash for a fixture's composition: its id's characters, padded to sha256's 64 hex digits. */
const hashOf = (id: string) =>
  [...id.toLowerCase()]
    .map((char) => char.charCodeAt(0).toString(16).slice(-1))
    .join('')
    .padEnd(64, '0');

/** The copy a fixture's graphic is drawn with: a record of a design, with one text variable for its words. */
function compositionOf(card: CardOf<'motionGraphic'>): GraphicComposition | null {
  const design = GRAPHIC_FIXTURE_DESIGNS[card.itemId];
  if (!design) return null;
  return {
    id: design.id,
    version: 1,
    hash: hashOf(design.id),
    name: design.name,
    entry: 'index.html',
    files: [{ path: 'index.html', sha256: hashOf(`${design.id}html`), bytes: 1_200 }],
    variables: [{ type: 'text', name: 'words', maxLength: 80, sample: design.words }],
    durationSeconds: 3,
    provenance: { model: null, overlays: [], brief: null, createdAt: 0 },
    gate: {
      version: '1',
      passed: true,
      checkedAt: 0,
      hfLint: { errors: 0, warnings: 0 },
      checks: [],
      loweredTweens: 4,
    },
  };
}

/** Where each slot starts on V1, in canvas frames. */
function slotStarts(timeline: Timeline): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  const video = timeline.tracks[0];
  if (video?.kind !== 'video') return starts;
  let at = 0;
  for (const item of video.items) {
    if (item.type === 'transition') continue;
    if (item.slotId) starts.set(item.slotId, at);
    at += item.duration.value;
  }
  return starts;
}

function voiceTrack(timeline: Timeline, card: CardOf<'voiceover'>, n: number): AudioTrack {
  const starts = slotStarts(timeline);
  const rate = timeline.canvas.rate;
  const items: SequenceItem[] = [];
  let cursor = 0;
  card.voiceover.lines.forEach((line, k) => {
    const start = (line.slotId && starts.get(line.slotId)) || cursor;
    if (!line.clipId || !line.duration) return;
    if (start > cursor)
      items.push({
        type: 'gap',
        id: `01K7C5M6Q8R9S0T1V2W3X4MZ${n}${k}` as SequenceItem['id'],
        duration: RationalTime.of(start - cursor, rate),
        slotId: null,
      });
    const length = RationalTime.of(line.duration.value, rate);
    const clip: Clip = {
      type: 'clip',
      id: line.clipId,
      media: {
        kind: 'audio',
        assetId: `01K7C5M6Q8R9S0T1V2W3X4MA${n}${k}` as Clip['media']['assetId'],
        available: { start: RationalTime.zero(rate), duration: length },
      },
      sourceStart: RationalTime.zero(rate),
      duration: length,
      speed: null,
      slotId: line.slotId,
      syncPoint: null,
      beatAnchor: null,
      fit: 'cover',
      audio: { gainDb: 0, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    };
    items.push(clip);
    cursor = start + length.value;
  });
  return { kind: 'audio', id: 'A2', name: 'Voice', enabled: true, role: 'voice', items };
}

function graphicItem(card: CardOf<'motionGraphic'>, composition: GraphicComposition): GraphicItem {
  const phrase = card.unmatched[0];
  const words = composition.variables[0]?.type === 'text' ? composition.variables[0].sample : '';
  return {
    type: 'graphic',
    id: card.itemId,
    anchor: phrase ? { kind: 'phrase', text: phrase, occurrence: 1 } : { kind: 'time', at: card.start },
    start: card.start,
    duration: card.duration,
    placement: { box: { x: 0.08, y: 0.1, width: 0.84, height: 0.2 } },
    styleKey: 'composition',
    language: null,
    origin: 'agent',
    composition: { id: composition.id, hash: composition.hash, params: { words } },
    // EDT1-GFX: the chat's founder card is still a proposal.
    ...(card.itemId === MEDIA_FIXTURE_IDS.graphics.founderCard
      ? {
          proposal: {
            // eslint-disable-next-line lingui/no-unlocalized-strings -- the person's words in a made-up chat: data
            request: 'add a lower third with my name',
            design: 'designed' as const,
            createdAt: 0,
          },
        }
      : {}),
  };
}

/** The image takes' slot as the placed still, or a gap while nothing is placed. */
function withImageSlot(timeline: Timeline, card: CardOf<'imageTakes'>): Timeline {
  const [video, ...rest] = timeline.tracks;
  if (video?.kind !== 'video') return timeline;
  const index = video.items.findIndex((item) => item.type === 'clip' && item.slotId === card.slotId);
  const clip = video.items[index];
  if (clip?.type !== 'clip') return timeline;
  const filled: SequenceItem = card.placed
    ? {
        ...clip,
        media: { kind: 'image', assetId: card.placed },
        sourceStart: RationalTime.zero(clip.sourceStart.rate),
        speed: null,
        syncPoint: null,
        stillMotion: 'pushIn',
        reframe: null,
      }
    : { type: 'gap', id: clip.id, duration: clip.duration, slotId: clip.slotId };
  const items = video.items.map((item, i) => (i === index ? filled : item));
  const cast =
    timeline.cast && !card.placed
      ? {
          ...timeline.cast,
          slots: timeline.cast.slots.map((slot) =>
            slot.clipId === clip.id ? { ...slot, clipId: null } : slot,
          ),
        }
      : timeline.cast;
  return { ...timeline, tracks: [{ ...video, items }, ...rest], cast };
}

/** One Golden hour timeline with the media cards' fixtures for it; the document as it was if it isn't one. */
export function arrangeMedia(timeline: Timeline): Timeline {
  const n = MEDIA_FIXTURE_IDS.timelines.findIndex((id) => id === timeline.id);
  if (n < 0 || timeline.projectId !== MEDIA_FIXTURE_IDS.project) return timeline;
  const voiceover = Object.values(CARD_FIXTURES.voiceover).find((card) => card.timelineId === timeline.id);
  // HFW1-UI's designed fixtures have no design here: they go on with `media.designs` (workspace/design-arrange.ts).
  const designs = Object.values(CARD_FIXTURES.motionGraphic)
    .filter((card) => card.timelineId === timeline.id)
    .flatMap((card) => {
      const composition = compositionOf(card);
      return composition ? [{ card, composition }] : [];
    });
  const graphics = designs
    .map(({ card, composition }) => graphicItem(card, composition))
    .sort((a, b) => a.start.value - b.start.value);
  const takes = Object.values(CARD_FIXTURES.imageTakes).find((card) => card.timelineId === timeline.id);

  let next: Timeline = timeline;
  if (voiceover)
    next = {
      ...next,
      tracks: [...next.tracks.filter((track) => track.id !== 'A2'), voiceTrack(next, voiceover, n + 1)],
      voiceover: {
        ...voiceover.voiceover,
        voiceId: `fake-voice-${n + 1}`,
        seed: n + 1,
      },
    };
  if (graphics.length > 0)
    next = {
      ...next,
      tracks: [
        ...next.tracks.filter((track) => track.id !== 'T2'),
        { kind: 'text', id: 'T2', name: 'Graphics', enabled: true, items: graphics },
      ],
      graphicCompositions: designs.map(({ composition }) => composition),
    };
  if (takes) next = withImageSlot(next, takes);
  const checked = timelineSchema.safeParse(next);
  return checked.success ? checked.data : timeline;
}
