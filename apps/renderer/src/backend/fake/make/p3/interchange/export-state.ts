// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the export area's fakes keep between calls, as the real backend keeps it in other places: each project's
 * Content Credentials choice (render's export setting), what the library knows about where an asset came from
 * (provenance: stock, generated, bundled; the fake library's own clips are all captured), the files
 * `timeline.exportInterchange` wrote to Taalcut's exports folder, and the warped music files in the media cache.
 *
 * One state per fake backend: `startExportState` (createFakeInterchange) begins a fresh one, and the readers that
 * the shared Make and library fakes call without a handle to it (export options, library.credits) read the
 * current one. A page has one fake backend; a test that makes a new backend starts clean.
 */
import type { AssetId, AssetProvenance, ProjectId } from '@taalcut/core';

export interface ExportFakeState {
  /** render.setContentCredentials, per project; absent is render's default, off. */
  readonly credentials: Map<ProjectId, boolean>;
  /** Where an asset came from, for the assets the fake library doesn't model (stock, generated, bundled). */
  readonly provenance: Map<AssetId, AssetProvenance>;
  /** File names in Taalcut's exports folder, as the sink wrote them. */
  readonly files: Set<string>;
  /**
   * The media cache's warped music files, by `warpedKey` (music.generate writes one; the showcase seeds its own).
   * A generated-music export whose file isn't here stops at preflight with `render.media_missing`.
   */
  readonly warpedMusic: Set<string>;
}

const fresh = (): ExportFakeState => ({
  credentials: new Map(),
  provenance: new Map(),
  files: new Set(),
  warpedMusic: new Set(),
});

let current: ExportFakeState = fresh();

/** A new backend's export state, made current. */
export function startExportState(): ExportFakeState {
  current = fresh();
  return current;
}

/** The current backend's export state. */
export function exportState(): ExportFakeState {
  return current;
}
