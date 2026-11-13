// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the editor's gap fixes (P3-B8) · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.3 · the inside of "Fix this gap": the kit's GapFixView for one gap, its fixes worked out
 *   here (no agent proposed them): film it, ask the chat for an image (its cost comes there, first), stock video
 *   for the slot's words, drop the slot and re-time. Each fix is the same command a card's would be
 * states: loading (two quiet lines while timelines.gaps answers) · error (the cause, Try again) · default (the
 *   rows) · pending/error per row (GapFixView) · success (the gap becomes a clip or goes: a toast with Undo, and the
 *   popover closes with it)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, type GapView, type ProjectId, type TaalcutError, type Timeline } from '@taalcut/core';
import {
  Button,
  errorMessage,
  GapFixView,
  SkeletonLines,
  toast,
  useSettledGaps,
  type GapFixHandlers,
  type GapFixItem,
  type GapFixOptionView,
  VERB_ICONS,
} from '@taalcut/ui';
import { useEffect, useMemo, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useAppCardActions } from '../../../chat/card-actions';
import { askWith } from '../../../chat/selection-store';
import { useMediaUrls } from '../../../services/provider';
import { gapsCardData } from './gaps-card-data';
import { fillGapWithStock } from './stock-use';

export interface GapFixPanelProps {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  readonly gapId: GapView['gapId'];
  /** The video's length in frames, for "The video becomes …". */
  readonly total: number;
  /** A fix went through (or the chat took the request): the popover closes. */
  readonly onDone: (outcome: 'filled' | 'dropped' | 'asked') => void;
}

/** What the editor offers for a gap: every fix it can make, the agent's cost estimate left to the chat. */
export function editorItem(gap: GapView, total: number, alone: boolean): GapFixItem {
  const options: GapFixOptionView[] = [
    { kind: 'film' },
    { kind: 'generate', provider: null, model: null, estimate: null, prompt: null },
  ];
  const query = gap.intent?.text.trim();
  if (query) options.push({ kind: 'stock', query: query.slice(0, 200) });
  if (!alone)
    options.push({
      kind: 'drop',
      newDuration: { value: total - gap.duration.value, rate: gap.duration.rate },
    });
  return { ...gap, options, unavailable: [], outcome: 'open' };
}

type Load =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: TaalcutError }
  | {
      readonly status: 'ready';
      readonly gap: GapView | null;
    };

export function GapFixPanel({ projectId, timeline, gapId, total, onDone }: GapFixPanelProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const actions = useAppCardActions();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const timelineId = timeline.id;
  const revision = timeline.revision;

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    void callRpc(backend.timelines.gaps({ timelineId })).then((result) => {
      if (!live) return;
      if (!result.ok) return setLoad({ status: 'error', error: result.error });
      setLoad({ status: 'ready', gap: result.value.find((gap) => gap.gapId === gapId) ?? null });
    });
    return () => {
      live = false;
    };
  }, [backend, timelineId, revision, gapId, attempt]);

  const alone = (timeline.tracks[0]?.items.filter((item) => item.type !== 'transition').length ?? 0) <= 1;
  const items = useMemo(
    () => (load.status === 'ready' && load.gap ? [editorItem(load.gap, total, alone)] : []),
    [load, total, alone],
  );
  const { gaps, settle } = useSettledGaps(items);
  const media = useMediaUrls();
  const data = useMemo(() => gapsCardData(backend, media), [backend, media]);

  if (load.status === 'loading') return <SkeletonLines lines={3} />;
  if (load.status === 'error')
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-danger-strong">
        <span className="min-w-0">{errorMessage(i18n, load.error)}</span>
        <Button size="sm" variant="ghost" icon={VERB_ICONS.retry} onClick={() => setAttempt((n) => n + 1)}>
          {t`Try again`}
        </Button>
      </div>
    );
  if (gaps.length === 0)
    return <p className="m-0 text-sm text-ink-2">{t`This shot isn’t empty any more.`}</p>;

  const { undo, dispatch } = actions;
  const withUndo = undo ? { action: { label: t`Undo`, onSelect: () => void undo() } } : {};
  const handlers: GapFixHandlers = {
    onFilm: () => actions.navigate?.({ to: 'phone' }),
    onGenerate: (gap) => {
      const n = i18n.number(gap.number);
      askWith(t`Generate an image for shot ${n}`, [
        { kind: 'range', timelineId, range: { start: gap.start, duration: gap.duration } },
      ]);
      onDone('asked');
    },
    ...(data.stockSearch ? { onStockSearch: data.stockSearch } : {}),
    onStockUse: async (gap, item) => {
      const result = await fillGapWithStock(backend, { item, projectId, timelineId, gapId: gap.gapId });
      if (result.ok) {
        const n = i18n.number(gap.number);
        toast({ tone: 'success', title: t`Shot ${n}: stock video from Pexels`, ...withUndo });
        onDone('filled');
      }
      return result;
    },
    ...(dispatch
      ? {
          onDrop: async (gap: GapFixItem) => {
            const result = await dispatch('timeline.dropSlot', {
              projectId,
              timelineId,
              itemId: gap.gapId,
              mode: 'ripple',
            });
            if (result.ok) {
              const n = i18n.number(gap.number);
              toast({ title: t`Shot ${n} dropped`, ...withUndo });
              onDone('dropped');
            }
            return result;
          },
        }
      : {}),
    onSettings: (section) => actions.navigate?.({ to: 'settings', section }),
  };
  return <GapFixView gaps={gaps} onSettled={settle} level={3} {...handlers} />;
}
