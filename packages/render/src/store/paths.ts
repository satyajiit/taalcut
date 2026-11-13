// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where one render's files are, agreed between the export pipeline (which
 * writes the checked file into its work folder), `render.overrideQa` (which
 * delivers a needsAttention render after "Export anyway") and the purge job.
 * The file reaches `renders/` only through finalizeRender.
 */
import { join } from 'node:path';
import type { ProjectId, RenderId } from '@taalcut/core';
import type { RenderFolders } from '../engine/deps';

export type SidecarFormat = 'srt' | 'vtt';

/** `<work>/<renderId>/`: removed when the render ends, kept while it needs attention. */
export function renderWorkDir(folders: Pick<RenderFolders, 'work'>, renderId: RenderId): string {
  return join(folders.work, renderId);
}

/** The muxed, checked file that waits in the work folder for delivery. */
export function renderWorkFile(folders: Pick<RenderFolders, 'work'>, renderId: RenderId): string {
  return join(renderWorkDir(folders, renderId), 'final.mp4');
}

/** A subtitle sidecar beside the work file. */
export function renderWorkSidecar(
  folders: Pick<RenderFolders, 'work'>,
  renderId: RenderId,
  format: SidecarFormat,
): string {
  return join(renderWorkDir(folders, renderId), `final.${format}`);
}

/** `<renders>/<projectId>/<renderId>.<ext>`: the delivered file and its sidecars. */
export function renderDestination(
  folders: Pick<RenderFolders, 'renders'>,
  projectId: ProjectId,
  renderId: RenderId,
  ext: 'mp4' | SidecarFormat = 'mp4',
): string {
  return join(folders.renders, projectId, `${renderId}.${ext}`);
}
