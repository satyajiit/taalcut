// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: where `timeline.assemble` gets the template's kept reel for the slots that keep its footage (core's
 * slot-footage.ts). The reel lives in the template media store (REF1), not in the library; a clip plays a library
 * asset. The composition root's port puts the reel in the library once (the same bytes are the same asset) the way
 * media the app itself brings in is kept: hidden from the person's library and from casting, and recorded so
 * render's inventory and Content Credentials never count it as the person's own footage. `timeline.cast` never
 * calls it: reading a cast changes nothing.
 *
 * A template with such a slot and no reel here is refused with the fix that fetches the reel again
 * (`templates.fetchMedia`, the fix the reel's music has when the reel is gone): the person asked for that footage to
 * stay, and filling the slot with their clips instead would make another video than the one they asked for.
 */
import {
  err,
  ok,
  type RunId,
  type AssetId,
  type AsyncResult,
  type ProjectId,
  type Template,
  type TemplateId,
} from '@taalcut/core';
import { reelMedia, type ReelMedia } from '../assembly/reel-footage';
import { hasReelSlots } from '../casting/reel-slots';
import { ReelMissing } from '../errors';

export interface ReelSourceInput {
  readonly templateId: TemplateId;
  /** The project the video is made in, for the asset's record. */
  readonly projectId: ProjectId;
  /** The agent run that asked, for the asset's record. */
  readonly runId: RunId | null;
}

/**
 * The template's kept reel as a library asset, put there when it isn't yet. Null when the template keeps no reel,
 * the file is gone, or it is not a video the library can hold.
 */
export type ReelSource = (input: ReelSourceInput) => AsyncResult<{ readonly assetId: AssetId } | null>;

export interface ReelDeps {
  /** Absent: no template's reel can be read here, and a template with reel slots is refused. */
  readonly reel?: ReelSource;
}

/** Core's `templates.fetchMedia`: fetches a template's reel again and keeps it (render's fix for the reel's music). */
const FETCH_TEMPLATE_MEDIA = 'templates.fetchMedia';

/** The template's reel isn't here for the slots that keep it: the fix is "Get the reel's video and music". */
export function reelMissing(templateId: TemplateId) {
  return ReelMissing(
    { templateId },
    {
      detail:
        "This template keeps the reel's own footage in some slots, and the reel's video isn't on this Mac. " +
        "Don't fill those slots another way: tell the user the reel has to be fetched again.",
      fix: { command: FETCH_TEMPLATE_MEDIA, labelKey: 'fix.getReelMedia', payload: { id: templateId } },
    },
  );
}

/**
 * The reel as clip media, for a template with slots that keep its footage; undefined for a template with none
 * (nothing is read or put in the library).
 */
export async function reelFor(
  deps: ReelDeps,
  template: Template,
  projectId: ProjectId,
  runId: RunId | null,
): AsyncResult<ReelMedia | undefined> {
  if (!hasReelSlots(template)) return ok(undefined);
  if (!deps.reel) return err(reelMissing(template.id));
  const found = await deps.reel({ templateId: template.id, projectId, runId });
  if (!found.ok) return found;
  return found.value ? ok(reelMedia(template, found.value.assetId)) : err(reelMissing(template.id));
}
