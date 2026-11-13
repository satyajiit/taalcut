// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Artifacts: large tool outputs (contact sheets, transcripts, shot lists)
 * stored once and passed around by id with a short summary, so they never
 * flood the model's context (PRD 7.2, "Context economy").
 *
 * Only the port lives here. The real store (on disk, next to the library) is
 * built later; @taalcut/tools ships an in-memory one for tests.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ULID_PATTERN, type ArtifactId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';

/** What a model or another tool sees instead of the artifact's bytes. */
export interface ArtifactRef {
  readonly id: ArtifactId;
  /** IANA media type, e.g. 'application/json', 'image/jpeg', 'text/vtt'. */
  readonly mediaType: string;
  readonly bytes: number;
  /** One or two plain sentences: what is in it, for the model. */
  readonly summary: string;
}

export interface ArtifactInput {
  readonly mediaType: string;
  readonly data: string | Uint8Array;
  readonly summary: string;
}

export interface StoredArtifact {
  readonly ref: ArtifactRef;
  readonly data: Uint8Array;
}

/** Port for storing large outputs. Tools reach it through their ToolContext. */
export interface ArtifactStore {
  put(artifact: ArtifactInput): AsyncResult<ArtifactRef>;
  get(id: ArtifactId): AsyncResult<StoredArtifact>;
}

/** Use inside a tool's output schema when the tool returns an artifact it stored itself. */
export const artifactRefSchema = z.object({
  id: z.string().regex(ULID_PATTERN).describe('Artifact id'),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  summary: z.string(),
});
