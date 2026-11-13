// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where generated and bundled files enter the library (P3-B6, P3-B7, P3-V6): @taalcut/library implements the sink
 * in the agent and jobs processes. The bytes are kept unchanged, content-addressed, recorded with their
 * provenance and queued for indexing. A generated asset nothing refers to any more is purged 30 days later.
 */
import type { AssetId, ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { RationalTime } from '../time/rational-time';
import type { Transcript } from '../analysis/transcript';
import type { AssetProvenance } from './asset-provenance';
import type { GeneratedMediaType } from './generated-media-types';

export { GENERATED_MEDIA_TYPES, type GeneratedMediaType } from './generated-media-types';

export interface GeneratedFile {
  readonly bytes: Uint8Array;
  readonly mediaType: GeneratedMediaType;
  /** Made by the caller from ids, e.g. 'voice-<lineId>.mp3'; never user text. */
  readonly fileName: string;
  /** The project it was made for; null for app-wide packs. */
  readonly projectId: ProjectId | null;
  readonly provenance: Exclude<AssetProvenance, { kind: 'captured' }>;
  /**
   * Round P3-3: what the file says, when the generator knows it exactly (a voice line's words from the
   * provider's character timings: engine 'tts'). The library stores it as the asset's transcript (check it
   * with transcriptSchema) and indexing doesn't transcribe this asset again.
   */
  readonly transcript?: Transcript;
}

/** A person's microphone take, kept by the same managed-file infrastructure with captured provenance. */
export interface RecordedFile extends Omit<GeneratedFile, 'provenance' | 'mediaType'> {
  readonly provenance: { readonly kind: 'captured' };
  readonly mediaType: 'audio/wav';
  readonly duration: RationalTime;
}
export interface GeneratedAssetSink {
  putRecording?(
    file: RecordedFile,
  ): AsyncResult<{ readonly assetId: AssetId; readonly contentHash: string; readonly duplicate: boolean }>;
  put(
    file: GeneratedFile,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<{ readonly assetId: AssetId; readonly contentHash: string; readonly duplicate: boolean }>;
}
export const GeneratedAssetSinkToken = createToken<GeneratedAssetSink>('core.generatedAssetSink');
