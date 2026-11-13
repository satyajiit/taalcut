// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V10, P3-V16: what the look cards read. `styles` (styles.list) for pickers and chips; `styleAssetUrl` for a
 * logo the list named (its media type comes from there); `watchNewestChange` for the styleBatch card's Undo all,
 * which shows only while the batch is the change app-wide undo would undo next.
 *
 * The newest change: command.changed events of the app-wide history (projectId null) since the page started,
 * checked against commands.history's next undo by name. Before the first event (a batch made before this
 * window opened) it isn't known, and the card hides Undo all rather than undo out of order.
 */
import { callRpc, styleAssetUrl, type CommandId, type LogoMediaType, type StyleSummary } from '@taalcut/core';
import type { CardData } from '@taalcut/ui';
import type { Backend } from '../../backend/backend';
import type { MediaUrls } from '../../backend/media';

interface Step {
  readonly id: CommandId;
  readonly name: string;
}

function trackHistory(backend: Backend) {
  const stack: Step[] = [];
  const listeners = new Set<(id: CommandId | null) => void>();
  let nextUndo: string | null | undefined;
  const newest = () => {
    const top = stack.at(-1);
    return top && nextUndo === top.name ? top.id : null;
  };
  const emit = () => {
    for (const listener of listeners) listener(newest());
  };
  const refresh = async () => {
    const history = await callRpc(backend.commands.history({ projectId: null }));
    nextUndo = history.ok ? history.value.undo : undefined;
    emit();
  };
  void (async () => {
    const stream = await callRpc(backend.events.subscribe({ types: ['command.changed'] }));
    if (!stream.ok) return;
    try {
      for await (const event of stream.value) {
        if (event.type !== 'command.changed' || event.payload.projectId !== null) continue;
        const { id, name, kind } = event.payload;
        const at = stack.findIndex((step) => step.id === id);
        if (at >= 0) stack.splice(at, 1);
        if (kind !== 'undone') stack.push({ id, name });
        void refresh();
      }
    } catch {
      // The subscription ended: the page or main is going away.
    }
  })();
  return (onChange: (id: CommandId | null) => void) => {
    listeners.add(onChange);
    onChange(newest());
    return () => void listeners.delete(onChange);
  };
}

/** One history watcher per backend, from the first card that asks, for the page's life. */
const histories = new WeakMap<Backend, ReturnType<typeof trackHistory>>();

export function looksCardData(
  backend: Backend,
  media: MediaUrls,
): Pick<CardData, 'styles' | 'styleAssetUrl' | 'watchNewestChange'> {
  const mediaTypes = new Map<string, LogoMediaType>();
  let watch = histories.get(backend);
  if (!watch) {
    watch = trackHistory(backend);
    histories.set(backend, watch);
  }
  return {
    async styles(): Promise<readonly StyleSummary[]> {
      const listed = await callRpc(backend.styles.list());
      if (!listed.ok) return [];
      for (const style of listed.value)
        if (style.logo) mediaTypes.set(style.logo.asset, style.logo.mediaType);
      return listed.value;
    },
    styleAssetUrl(sha256: string) {
      const mediaType = mediaTypes.get(sha256);
      return mediaType ? media.preview(styleAssetUrl({ asset: sha256, mediaType })) : null;
    },
    watchNewestChange: watch,
  };
}
