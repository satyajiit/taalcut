// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One look on many videos (P3-V16): `batch.applyStyle` over every video of the picked projects, one app-wide undo
 * step. The toast says what was applied and what was skipped and why ("2 videos have no captions"); its Undo is
 * the app-wide ⌘Z, whose receipt (batchStyleResultSchema, contract-3 §2) says which videos were changed since
 * and keep their look.
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  BATCH_COMMANDS,
  batchStyleResultSchema,
  type BatchStyleResult,
  type CaptionPresetId,
  type ProjectId,
  type StyleSummary,
  type TimelineId,
} from '@taalcut/core';
import { CAPTION_PRESET_LABELS, toast, UserContent } from '@taalcut/ui';
import type { Backend } from '../../../backend/backend';
import { useUndoable } from '../../make/use-undoable';

export type PickedLook =
  | { readonly kind: 'style'; readonly style: Pick<StyleSummary, 'id' | 'name'> }
  | { readonly kind: 'captionPreset'; readonly presetId: CaptionPresetId };

export interface BatchItem {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
}

/** Every video of these projects, as batch items (at most 50: batch.applyStyle's and exportBatch's limit). */
export async function videosOf(
  backend: Backend,
  projectIds: readonly ProjectId[],
  signal?: AbortSignal,
): Promise<BatchItem[]> {
  const lists = await Promise.all(
    projectIds.map((projectId) => backend.timelines.listByProject({ projectId }, { signal })),
  );
  return lists.flat().map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));
}

export const BATCH_LIMIT = 50;

const parse = (result: unknown): BatchStyleResult | null => {
  const parsed = batchStyleResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
};
const count = (result: BatchStyleResult | null, reason: 'noCaptions' | 'changedSince') =>
  result?.skipped.filter((item) => item.reason === reason).length ?? 0;

export function useApplyLook() {
  const { t, i18n } = useLingui();
  const undoable = useUndoable();
  const apply = (items: readonly BatchItem[], look: PickedLook) => {
    const name =
      look.kind === 'style' ? (
        <UserContent translate="no">{look.style.name}</UserContent>
      ) : (
        i18n._(CAPTION_PRESET_LABELS[look.presetId])
      );
    return undoable.run({
      name: BATCH_COMMANDS.applyStyle,
      payload: {
        items,
        apply:
          look.kind === 'style'
            ? { kind: 'style', styleId: look.style.id }
            : { kind: 'captionPreset', presetId: look.presetId },
      },
      projectId: null,
      done: (result) => {
        const applied = parse(result)?.applied.length ?? items.length;
        return applied > 0 ? (
          <Trans>
            Applied {name} to <Plural value={applied} one="# video" other="# videos" />
          </Trans>
        ) : (
          <Trans>{name} fits none of these videos</Trans>
        );
      },
      detail: (result) => {
        const skipped = count(parse(result), 'noCaptions');
        return skipped > 0 ? (
          <Plural
            value={skipped}
            one="# video has no captions, so it kept its look"
            other="# videos have no captions, so they kept their look"
          />
        ) : null;
      },
      failed: t`Couldn’t apply the look`,
      undone: (result) => {
        const stayed = count(parse(result), 'changedSince');
        if (stayed > 0)
          toast({
            tone: 'warning',
            title: (
              <Plural
                value={stayed}
                one="# video was changed since; its look stays"
                other="# videos were changed since; their look stays"
              />
            ),
          });
      },
    });
  };
  return { apply, pending: undoable.pending };
}
