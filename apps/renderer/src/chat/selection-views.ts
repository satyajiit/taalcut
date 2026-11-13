// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a selection chip says (P2-M7): core's chips carry ids only, so the
 * composer's tray and a sent message resolve each one against the thing it
 * names (timelines.get for a clip, an item or a range, templates.get for a
 * slot) into the kit's SelectionChipView: "Clip 3 · 00:04", "Text · 00:02",
 * "00:04–00:07", "Slot 2".
 * A clip or slot that isn't there any more is `gone` ("This was deleted.").
 * Lookups are shared and dropped when library.changed names the thing.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  findEditItem,
  type AssetSummary,
  type ChatEffectId,
  type ProjectId,
  type SelectionChip,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { SelectionChipView } from '@taalcut/ui';
import { useEffect, useMemo, useState } from 'react';
import type { Backend } from '../backend/backend';
import { useBackend } from '../backend/backend';
import { useBackendEvents } from '../backend/use-events';
import { effectLabel } from '../features/effects/effects';
import { buildModel, toFrames } from '../features/timeline/model';
import { selectionKey } from './selection-store';

export interface ResolvedChip {
  readonly key: string;
  readonly chip: SelectionChip;
  /** Null while it loads, or when the thing is gone and nothing is known of it. */
  readonly view: SelectionChipView | null;
  readonly gone: boolean;
  /** Where "open" goes: the timeline's project (clip and range chips). */
  readonly projectId: ProjectId | null;
}

const timelines = new WeakMap<Backend, Map<string, Promise<Timeline | null>>>();
const templates = new WeakMap<Backend, Map<string, Promise<Template | null>>>();
const assets = new WeakMap<Backend, Map<string, Promise<AssetSummary | null>>>();

function cached<T>(
  store: WeakMap<Backend, Map<string, Promise<T | null>>>,
  backend: Backend,
  id: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  let byId = store.get(backend);
  if (!byId) store.set(backend, (byId = new Map()));
  let found = byId.get(id);
  if (!found) byId.set(id, (found = load()));
  return found;
}

function forget(backend: Backend, id: string): void {
  timelines.get(backend)?.delete(id);
  templates.get(backend)?.delete(id);
  assets.get(backend)?.delete(id);
}

async function resolve(
  backend: Backend,
  chip: SelectionChip,
  labelForEffect: (effectId: ChatEffectId) => string,
): Promise<ResolvedChip> {
  const key = selectionKey(chip);
  if (chip.kind === 'effect') {
    return {
      key,
      chip,
      view: { kind: 'effect', key, label: labelForEffect(chip.effectId) },
      gone: false,
      projectId: null,
    };
  }
  if (chip.kind === 'asset') {
    const asset = await cached(assets, backend, chip.assetId, async () => {
      const got = await callRpc(backend.library.asset({ assetId: chip.assetId }));
      return got.ok ? got.value.asset : null;
    });
    if (!asset) {
      return {
        key,
        chip,
        view: chip.name ? { kind: 'asset', key, name: chip.name } : null,
        gone: true,
        projectId: null,
      };
    }
    return {
      key,
      chip,
      view: { kind: 'asset', key, name: asset.name },
      gone: asset.trashed,
      projectId: null,
    };
  }
  if (chip.kind === 'slot') {
    const template = await cached(templates, backend, chip.templateId, async () => {
      const got = await callRpc(backend.templates.get({ templateId: chip.templateId }));
      return got.ok ? got.value.template : null;
    });
    const index = template?.slots.findIndex((slot) => slot.id === chip.slotId) ?? -1;
    if (!template || index < 0) return { key, chip, view: null, gone: true, projectId: null };
    const slot = template.slots[index]!;
    return {
      key,
      chip,
      view: { kind: 'slot', key, index: index + 1, name: slot.name },
      gone: false,
      projectId: null,
    };
  }
  const timeline = await cached(timelines, backend, chip.timelineId, async () => {
    const got = await callRpc(backend.timelines.get({ timelineId: chip.timelineId }));
    return got.ok ? got.value : null;
  });
  if (!timeline) return { key, chip, view: null, gone: true, projectId: null };
  const rate = timeline.canvas.rate;
  if (chip.kind === 'range') {
    const start = toFrames(chip.range.start, rate);
    const end = start + toFrames(chip.range.duration, rate);
    return {
      key,
      chip,
      view: { kind: 'range', key, start: { frames: start, rate }, end: { frames: end, rate } },
      gone: false,
      projectId: timeline.projectId,
    };
  }
  if (chip.kind === 'item') {
    const place = findEditItem(timeline, chip.itemId);
    if (!place) return { key, chip, view: null, gone: true, projectId: timeline.projectId };
    const at = { frames: place.start, rate };
    const { itemKind } = place.target;
    const view: SelectionChipView =
      itemKind === 'clip'
        ? { kind: 'clip', key, index: place.number, at }
        : { kind: 'item', key, itemKind, at, name: place.words };
    return { key, chip, view, gone: false, projectId: timeline.projectId };
  }
  const clip = buildModel(timeline).clips.find((view) => view.item.id === chip.clipId);
  if (!clip) return { key, chip, view: null, gone: true, projectId: timeline.projectId };
  return {
    key,
    chip,
    view: { kind: 'clip', key, index: clip.number, at: { frames: clip.start, rate } },
    gone: false,
    projectId: timeline.projectId,
  };
}

/** Each chip with its words, resolved against the thing it names, kept current. */
export function useChipViews(chips: readonly SelectionChip[]): readonly ResolvedChip[] {
  const backend = useBackend();
  const { i18n } = useLingui();
  const [round, setRound] = useState(0);
  const [resolved, setResolved] = useState<ReadonlyMap<string, ResolvedChip>>(new Map());
  const keys = chips.map(selectionKey).join('|');
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity !== 'timeline' && payload.entity !== 'template' && payload.entity !== 'asset') return;
    const named = chips.some((chip) => {
      if (chip.kind === 'effect') return false;
      if (chip.kind === 'asset') return payload.entity === 'asset' && payload.ids.includes(chip.assetId);
      if (chip.kind === 'slot') return payload.entity === 'template' && payload.ids.includes(chip.templateId);
      return payload.entity === 'timeline' && payload.ids.includes(chip.timelineId);
    });
    if (!named) return;
    for (const id of payload.ids) forget(backend, id);
    setRound((n) => n + 1);
  });
  useEffect(() => {
    let live = true;
    const labelForEffect = (id: ChatEffectId) => effectLabel(i18n, id);
    void Promise.all(chips.map((chip) => resolve(backend, chip, labelForEffect))).then((list) => {
      if (!live) return;
      // Something deleted since it was shown keeps the words it had, struck through.
      setResolved(
        (before) =>
          new Map(
            list.map((entry) => {
              const view = entry.view ?? (entry.gone ? (before.get(entry.key)?.view ?? null) : null);
              return [entry.key, { ...entry, view }];
            }),
          ),
      );
    });
    return () => {
      live = false;
    };
    // `keys` stands for the chips.
  }, [backend, keys, round, i18n.locale]);
  return useMemo(
    () =>
      chips.map((chip) => {
        const key = selectionKey(chip);
        if (chip.kind === 'effect') {
          return {
            key,
            chip,
            view: { kind: 'effect', key, label: effectLabel(i18n, chip.effectId) },
            gone: false,
            projectId: null,
          };
        }
        const found = resolved.get(key);
        if (found) return found;
        return {
          key,
          chip,
          view: chip.kind === 'asset' && chip.name ? { kind: 'asset', key, name: chip.name } : null,
          gone: false,
          projectId: null,
        };
      }),
    [chips, resolved, i18n.locale],
  );
}
