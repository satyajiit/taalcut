// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: what a cover is made of, held at the handoff from facts the run has. The model states the medium it
 * understood on the save (`medium`: footage, generated or drawn), and nothing here reads the person's words:
 * the check holds the cover to what its stated medium means. A cover asked for in the cover panel is a designed
 * composition (`workspace.placeCover`), never a frame saved as it is. A request that came without a note named
 * no medium, so its cover is footage. A footage cover's pictures are frames of the video or library shots, none
 * of them made by an image tool in this run. A generated cover has a picture an image tool could have made.
 */
import type { ArtifactStore, CoverRequest } from '@taalcut/core';
import type { RunState } from '../run-state';
import { recordedToolReceipt } from './tool-receipt';

/** The tools that save a cover: a designed composition, or a frame or image as it is. */
export const COVER_PLACE_TOOL = 'workspace.placeCover';
export const COVER_SET_TOOL = 'timeline.setCover';

export interface CoverSave {
  readonly tool: typeof COVER_PLACE_TOOL | typeof COVER_SET_TOOL;
  readonly aspect: string;
  /** As the model stated it on the save; absent when it stated none. */
  readonly medium?: string;
  /** Library assets its pictures are; a frame of the video is not one. */
  readonly assets: readonly string[];
  /** How many pictures it names (frames and assets). */
  readonly pictures: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** The covers this run saved for the step's timeline, oldest first, as their calls' inputs state them. */
export function coverSaves(state: RunState, input: Record<string, unknown>): CoverSave[] {
  const saves: CoverSave[] = [];
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    const requested = asRecord(call?.requested.input);
    if (
      !requested ||
      call?.outcome?.kind !== 'completed' ||
      requested.projectId !== input.projectId ||
      requested.timelineId !== input.timelineId
    )
      continue;
    if (call.requested.tool === COVER_PLACE_TOOL) {
      const pictures = (Array.isArray(requested.pictures) ? requested.pictures : []).map(asRecord);
      const medium = text(requested.medium);
      saves.push({
        tool: COVER_PLACE_TOOL,
        aspect: text(requested.aspect) ?? '',
        ...(medium ? { medium } : {}),
        assets: pictures.flatMap((picture) => text(picture?.assetId) ?? []),
        pictures: pictures.length,
      });
    } else if (call.requested.tool === COVER_SET_TOOL) {
      const cover = asRecord(requested.cover);
      const source = asRecord(cover?.source);
      const medium = text(cover?.medium);
      saves.push({
        tool: COVER_SET_TOOL,
        aspect: text(cover?.aspect) ?? '',
        ...(medium ? { medium } : {}),
        assets: source?.kind === 'asset' ? [text(source.assetId) ?? ''] : [],
        pictures: source?.kind === 'solid' ? 0 : 1,
      });
    }
  }
  return saves;
}

/** Every `assetId` in a tool's result, wherever it sits. */
function assetIdsIn(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 64)) assetIdsIn(item, into, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'assetId' && typeof item === 'string') into.add(item);
    else assetIdsIn(item, into, depth + 1);
  }
}

/** The assets image tools made in this run (`image.*`, `images.*`), from their recorded results. */
export async function generatedAssets(
  state: RunState,
  artifacts?: Pick<ArtifactStore, 'get'>,
): Promise<Set<string>> {
  const made = new Set<string>();
  for (const id of state.toolCallOrder) {
    const call = state.toolCalls[id];
    if (!call || !/^images?\./u.test(call.requested.tool) || call.outcome?.kind !== 'completed') continue;
    assetIdsIn(await recordedToolReceipt(call, artifacts), made);
  }
  return made;
}

const FOOTAGE_ROUTE =
  'Choose frames with timeline.captureFrame, write a composition on the cover’s canvas (workspace.new with ' +
  'cover) that draws them with <img data-picture>, and save it with workspace.placeCover, medium "footage".';

/**
 * Why the cover this run saved is not the cover owed, or undefined. `owed`: the cover panel's request, when the
 * cover was asked for there; `generated`: the assets image tools made in this run.
 */
export function coverMediumProblem(
  save: CoverSave,
  owed: CoverRequest | undefined,
  generated: ReadonlySet<string>,
): string | undefined {
  if (owed && save.tool === COVER_SET_TOOL)
    return (
      'The cover saved is a frame as it is (timeline.setCover): a bare frame is not a designed cover. ' +
      `${FOOTAGE_ROUTE} Then export it again.`
    );
  if (owed && !save.medium)
    return 'The cover was saved without its medium: state medium on workspace.placeCover (footage, generated or drawn).';
  if (owed && !owed.note && save.medium !== 'footage')
    return (
      `The cover saved states medium "${save.medium}", and the person asked for none: they pressed Generate with ` +
      'AI and left no note, so the cover’s picture is the video’s own footage, not drawn or generated art. ' +
      `${FOOTAGE_ROUTE} Then export it again.`
    );
  if (save.medium === 'footage') {
    const made = save.assets.find((asset) => generated.has(asset));
    if (made)
      return (
        `The cover states medium "footage" and its picture ${made} was made by an image tool in this run: that is ` +
        'generated art, which the person did not ask for. Use frames of the video (pictures: [{name, frame}]) or ' +
        'their own library shots, and place and export it again.'
      );
    if (save.pictures === 0)
      return (
        'The cover states medium "footage" and names no picture, so what it shows is drawn. A footage cover is ' +
        `built over a frame of the video. ${FOOTAGE_ROUTE} Then export it again.`
      );
  }
  if (save.medium === 'generated' && save.assets.length === 0)
    return (
      'The cover states medium "generated" and none of its pictures is an image: generated art is a library ' +
      'asset an image tool returned (pictures: [{name, assetId}]). If no image could be generated, say that ' +
      'failure in one line, make the cover from the video’s own footage with medium "footage", and say that is ' +
      'what it is.'
    );
  return undefined;
}
