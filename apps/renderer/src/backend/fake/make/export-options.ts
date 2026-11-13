// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the export dialog and the export card read (renders.exportOptions):
 * every preset with whether this timeline fits it and a size and time
 * estimate, the music choice and (REF1) whether the template keeps its reel's
 * music, with the reel's link and sound for adding it in the app,
 * captions and (P3-V7) the Content Credentials note; and the live preview
 * sessions under app://preview. LNX1-AV1: each preset's codecs on the fake
 * machine, as render's exportOptions answers from media's hardware encoders.
 */
import type {
  ExportOptions,
  ExportPreset,
  ExportPresetId,
  ExportVideoCodec,
  ProjectId,
  TaalcutError,
  TemplateId,
  Timeline,
  TimelineId,
} from '@taalcut/core';
import type { FakeSystem } from '../fake-system';
import type { FakeTemplates } from '../templates/fake-templates';
import { framesOf } from './build';
import { exportCredentialsFor } from './p3/interchange/ai-parts';
import type { FakeTimelines } from './fake-timelines';
import type { IdMaker } from './ids';
import { estimateBytes } from './render-data';
import { PRESETS } from './render-presets';

/**
 * The codecs each fake machine's exports can be in: media's working hardware encoders (H.264 always, OpenH264 on
 * the CPU). Apple silicon has no AV1 encoder; NVENC AV1 needs an RTX 40 (Ada) or newer; nouveau has no NVENC.
 */
export const FAKE_VIDEO_CODECS: Readonly<Record<FakeSystem, readonly ExportVideoCodec[]>> = {
  mac: ['h264', 'hevc'],
  'linux-nvidia': ['h264', 'hevc', 'av1'],
  'linux-cpu': ['h264'],
  'linux-nvidia-old-driver': ['h264', 'hevc'],
  'linux-nouveau': ['h264'],
  'linux-pascal': ['h264', 'hevc'],
  // VA-API: RDNA 3 and Meteor Lake encode AV1.
  'linux-amd': ['h264', 'hevc', 'av1'],
  'linux-intel': ['h264', 'hevc', 'av1'],
};

/** render's CODEC_REASON_KEYS: why a codec can't be used on this machine. */
const CODEC_REASONS: Readonly<Record<Exclude<ExportVideoCodec, 'h264'>, string>> = {
  hevc: 'render.unavailable.noHevcEncoder',
  av1: 'render.unavailable.noAv1Encoder',
};

const codecsOf = (preset: ExportPreset) => preset.video.codecs ?? [preset.video.codec];
const codecOn = (codec: ExportVideoCodec, machine: readonly ExportVideoCodec[]) =>
  codec === 'h264' || machine.includes(codec)
    ? { codec, available: true }
    : { codec, available: false, reasonKey: CODEC_REASONS[codec] };

/** As render.export refuses it: a codec the preset doesn't offer, or one this machine can't encode. */
export function codecRefusal(
  preset: ExportPreset,
  codec: ExportVideoCodec | undefined,
  machine: readonly ExportVideoCodec[],
): TaalcutError | null {
  const wanted = codec ?? preset.video.codec;
  if (codecsOf(preset).includes(wanted) && codecOn(wanted, machine).available) return null;
  return {
    code: 'render.codec_unavailable',
    messageKey: 'errors.render.codec_unavailable',
    retryable: false,
  };
}

/** REF1: what a timeline's template keeps of its reel, as render reads the template media store. */
export interface ReelOf {
  /** The reel's music is kept on this Mac (the template's media, with sound). */
  readonly music: boolean;
  /** The link it was read from, for the add-this-sound steps; null for a file. */
  readonly url: string | null;
  /** The sound the platform credits, as "title · artist". */
  readonly sound: string | null;
}

/** The reel behind a template, from the fake's templates; null for a template the fake doesn't hold. */
export function reelOf(templates: FakeTemplates, templateId: TemplateId): ReelOf | null {
  const template = templates.template(templateId);
  if (!template) return null;
  const sound = template.audio.sound;
  return {
    music: templates.summary(templateId)?.media?.hasAudio === true,
    url: template.origin.kind === 'reference' ? template.origin.url : null,
    sound: sound ? [sound.title, sound.artist].filter(Boolean).join(' · ') : null,
  };
}

/** REF1: a video whose template keeps its reel's music plays that music by default, as timeline assembly sets it. */
export function withReelMusic(timeline: Timeline, reel: (templateId: TemplateId) => ReelOf | null): Timeline {
  const template = timeline.template;
  if (!template || timeline.music.path !== 'platformSound' || reel(template.id)?.music !== true)
    return timeline;
  return { ...timeline, music: { path: 'referenceAudio', templateId: template.id, gainDb: 0 } };
}

export function exportOptionsFor(
  projectId: ProjectId,
  timeline: Timeline,
  chosen: ExportPresetId | undefined,
  reel: ReelOf | null,
  machine: readonly ExportVideoCodec[] = FAKE_VIDEO_CODECS.mac,
): ExportOptions {
  const frames = framesOf(timeline);
  const seconds = frames / 30;
  return {
    projectId,
    timelineId: timeline.id,
    timelineRevision: timeline.revision,
    rate: timeline.canvas.rate,
    durationFrames: frames,
    presets: PRESETS.map((preset) => {
      const codecs = codecsOf(preset).map((codec) => codecOn(codec, machine));
      // The machine's answer first, as render's: no length fixes a missing encoder.
      const missing = codecs.every((codec) => !codec.available) ? codecs[0]?.reasonKey : undefined;
      const tooLong = seconds > preset.duration.maxSeconds;
      const tooShort = seconds < preset.duration.minSeconds;
      const reasonKey =
        missing ??
        (tooLong ? 'render.unavailable.tooLong' : tooShort ? 'render.unavailable.tooShort' : undefined);
      return {
        preset,
        available: reasonKey === undefined,
        ...(reasonKey ? { reasonKey } : {}),
        estimate: { bytes: estimateBytes(preset, seconds), renderMs: Math.round(seconds * 600) },
        ...(codecs.every((codec) => codec.available) ? {} : { codecs }),
      };
    }),
    defaultPresetId: chosen ?? 'reels',
    music: {
      current: timeline.music,
      referenceAudioAvailable: timeline.template !== null && reel?.music === true,
      // Since REF1 nothing stands before the reel's music.
      referenceAudioAcknowledged: true,
      platformSound: timeline.template
        ? {
            referenceUrl: reel?.url ?? null,
            soundLabel: reel?.sound ?? null,
            steps: (['reels', 'shorts', 'tiktok'] as const).map((platform) => ({
              platform,
              stepKeys: [1, 2, 3, 4].map((n) => `music.platformSound.steps.${platform}.${n}`),
            })),
          }
        : null,
    },
    captions: {
      available: timeline.captions !== null,
      enabled: timeline.captions?.enabled ?? false,
      language: timeline.captions?.language ?? null,
    },
    credentials: exportCredentialsFor(projectId, timeline),
  };
}

/** Preview sessions as the render process keeps them: a token and a revision bumped on every refresh. */
export function previewSessions(timelines: FakeTimelines, ids: IdMaker) {
  const sessions = new Map<string, { timelineId: TimelineId; revision: number; token: string }>();
  const sessionOf = (sessionId: string) => {
    const session = sessions.get(sessionId)!;
    const timeline = timelines.get(session.timelineId)!;
    return {
      sessionId: sessionId as never,
      url: `app://preview/${session.token}/index.html?rev=${session.revision}`,
      revision: session.revision,
      timelineRevision: timeline.revision,
      width: timeline.canvas.width,
      height: timeline.canvas.height,
      rate: timeline.canvas.rate,
      durationFrames: framesOf(timeline),
      compositionHash: (session.token + timeline.revision.toString(16)).padEnd(64, '0').slice(0, 64),
    };
  };
  return {
    openPreview(projectId: ProjectId, timelineId: TimelineId) {
      const timeline = timelines.get(timelineId);
      if (!timeline || timeline.projectId !== projectId) return null;
      const sessionId = ids.session();
      const token = sessionId.toLowerCase().padEnd(32, '0').slice(0, 32);
      sessions.set(sessionId, { timelineId, revision: 0, token });
      return sessionOf(sessionId);
    },
    refreshPreview(sessionId: string) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      session.revision += 1;
      return sessionOf(sessionId);
    },
    closePreview: (sessionId: string) => ({ closed: sessions.delete(sessionId) }),
  };
}
