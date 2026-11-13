// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One voiceover line's file (SPEC P3.3 step 2): the provider's bytes stored byte for byte through the sink with
 * their provenance, words grouped from the character timings, and the file's length. A line placement must
 * compress is stretched (≤ 8 %) into a new FLAC asset; the provider's original stays untouched beside it.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  err,
  ok,
  RationalTime,
  type AssetId,
  type AsyncResult,
  type GeneratedAssetSink,
  type GeneratedProvenance,
  type GenerationTrace,
  type ProjectId,
  type VoiceLineId,
  type VoiceProvider,
  type VoiceQuality,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { GenerationUnavailable } from '../errors';
import { decodeAudioFile } from '../pcm/decode';
import { writePcmFile } from '../pcm/encode';
import type { TimeStretcher } from '../stretch/stretcher';
import { alignWords, LINE_RATE, scaleAlignedLine, ttsTranscript, type AlignedLine } from './alignment';

export interface LineFileDeps {
  readonly provider: VoiceProvider;
  readonly sink: GeneratedAssetSink;
  readonly stretcher: TimeStretcher;
  readonly media: MediaContext;
  readonly clock: { now(): number };
  readonly scratchDir?: string;
}

export interface LineRequest {
  readonly lineId: VoiceLineId;
  readonly projectId: ProjectId;
  readonly text: string;
  readonly voiceId: string;
  readonly language: string;
  readonly quality: VoiceQuality;
  readonly seed: number;
  readonly previousText?: string;
  readonly nextText?: string;
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

export interface LineFile {
  readonly assetId: AssetId;
  /** The file's length at LINE_RATE. */
  readonly duration: RationalTime;
  readonly aligned: AlignedLine;
  readonly provenance: GeneratedProvenance;
  readonly costUsd: number;
  /** The provider's bytes, kept in memory so placement can compress the line without reading it back. */
  readonly bytes: Uint8Array;
  readonly extension: string;
}

const RATE = LINE_RATE.num;

/** The file's length in samples at LINE_RATE, from the decoded audio. */
async function fileLength(deps: LineFileDeps, bytes: Uint8Array, extension: string, signal?: AbortSignal) {
  const dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-line-'));
  try {
    const path = join(dir, `line.${extension}`);
    await writeFile(path, bytes);
    const pcm = await decodeAudioFile(path, deps.media, {
      sampleRate: RATE,
      channels: 1,
      ...(signal ? { signal } : {}),
    });
    if (!pcm.ok) return pcm;
    return ok(RationalTime.of(pcm.value.channels[0]?.length ?? 0, LINE_RATE));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function generateLineFile(deps: LineFileDeps, request: LineRequest): AsyncResult<LineFile> {
  const available = deps.provider.available();
  if (!available.ok) return err(GenerationUnavailable({ reason: available.reason }));
  const made = await deps.provider.synthesize({
    text: request.text,
    voiceId: request.voiceId,
    language: request.language,
    quality: request.quality,
    seed: request.seed,
    ...(request.previousText ? { previousText: request.previousText } : {}),
    ...(request.nextText ? { nextText: request.nextText } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.trace ? { trace: request.trace } : {}),
  });
  if (!made.ok) return made;
  const extension = made.value.mediaType === 'audio/wav' ? 'wav' : 'mp3';
  const provenance: GeneratedProvenance = {
    kind: 'generated',
    generation: 'voice',
    provider: made.value.provider,
    model: made.value.model,
    access: 'api-key',
    quality: request.quality,
    promptSha256: createHash('sha256').update(request.text).digest('hex'),
    voiceId: request.voiceId,
    providerRef: null,
    c2pa: made.value.c2pa,
    costUsd: made.value.costUsd,
    runId: null,
    createdAt: deps.clock.now(),
  };
  const aligned = alignWords(made.value.alignment, request.language);
  // The line's exact words are the asset's transcript: indexing doesn't transcribe it again.
  const stored = await deps.sink.put(
    {
      bytes: made.value.bytes,
      mediaType: made.value.mediaType,
      fileName: `voice-${request.lineId.toLowerCase()}-${request.quality}.${extension}`,
      projectId: request.projectId,
      provenance,
      transcript: ttsTranscript(aligned, request.language, made.value.model),
    },
    request.signal ? { signal: request.signal } : {},
  );
  if (!stored.ok) return stored;
  const duration = await fileLength(deps, made.value.bytes, extension, request.signal);
  if (!duration.ok) return duration;
  return ok({
    assetId: stored.value.assetId,
    duration: duration.value,
    aligned,
    provenance,
    costUsd: made.value.costUsd,
    bytes: made.value.bytes,
    extension,
  });
}

/**
 * The line compressed to `ratio` of its length, as a new FLAC asset. The stretched file isn't the provider's
 * output any more, so it claims no C2PA; the provider's original keeps its own.
 */
export async function compressLineFile(
  deps: LineFileDeps,
  line: {
    readonly assetBytes: Uint8Array;
    readonly extension: string;
    readonly lineId: VoiceLineId;
    readonly projectId: ProjectId;
    readonly provenance: GeneratedProvenance;
    /** The provider's file's words and their language: the compressed file says them, scaled by `ratio`. */
    readonly aligned: AlignedLine;
    readonly language: string;
  },
  ratio: number,
  signal?: AbortSignal,
): AsyncResult<{ readonly assetId: AssetId; readonly duration: RationalTime }> {
  const dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-squeeze-'));
  try {
    const source = join(dir, `line.${line.extension}`);
    await writeFile(source, line.assetBytes);
    const pcm = await decodeAudioFile(source, deps.media, {
      sampleRate: RATE,
      channels: 1,
      ...(signal ? { signal } : {}),
    });
    if (!pcm.ok) return pcm;
    const frames = pcm.value.channels[0]?.length ?? 0;
    const target = Math.max(1, Math.round(frames * ratio));
    const stretched = await deps.stretcher.stretch(
      pcm.value,
      [{ sourceStart: 0, sourceEnd: frames, targetLength: target }],
      signal,
    );
    if (!stretched.ok) return stretched;
    const out = join(dir, 'squeezed.flac');
    const written = await writePcmFile(stretched.value, out, 'flac', deps.media, signal);
    if (!written.ok) return written;
    const stored = await deps.sink.put(
      {
        bytes: new Uint8Array(await readFile(out)),
        mediaType: 'audio/flac',
        fileName: `voice-${line.lineId.toLowerCase()}-x${Math.round(ratio * 1000)}.flac`,
        projectId: line.projectId,
        provenance: { ...line.provenance, c2pa: 'absent', costUsd: 0, createdAt: deps.clock.now() },
        transcript: ttsTranscript(
          scaleAlignedLine(line.aligned, ratio),
          line.language,
          line.provenance.model,
        ),
      },
      signal ? { signal } : {},
    );
    if (!stored.ok) return stored;
    return ok({ assetId: stored.value.assetId, duration: RationalTime.of(target, LINE_RATE) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
