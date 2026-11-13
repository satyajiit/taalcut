// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "What worked" (LRN1-MEM): when an export finishes (`render.finished`, status ready, which main streams to the
 * agent), a `learned` item in its template's scope names the template, the look and the choices that reached the
 * file. One item per template and Style: the next export of the same pair refreshes it and counts it, so memory
 * doesn't fill with copies. It is an ordinary item: visible in Settings → Memory, and gone for good once deleted.
 *
 * Exports that finished while the agent wasn't listening (it restarted, the app was closed mid-render) are caught
 * up at start from the render store, after a watermark kept in settings: a render at or before it is never
 * recorded again, so a deleted item stays deleted.
 */
import {
  defineSetting,
  MEMORY_COMMANDS,
  newId,
  ok,
  type AsyncResult,
  type CommandOrigin,
  type DispatchOptions,
  type MemoryItemView,
  type MemoryStore,
  type RenderId,
  type RenderRecord,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';
import type { RenderFacts } from './render-facts';

/** The newest export (finishedAt, epoch ms) the recorder has seen. */
export const WHAT_WORKED_SEEN_SETTING = defineSetting('memory.exportsSeenUntil', z.int().nonnegative(), 0);

const ORIGIN = { source: 'agent', actor: 'memory:exports' } as const;
/** Renders the catch-up reads at most. */
const CATCH_UP_LIMIT = 200;
const NAME_MAX = 80;

const PRESETS: Readonly<Record<RenderFacts['presetId'], string>> = {
  shorts: 'YouTube Shorts',
  reels: 'Instagram Reels',
  tiktok: 'TikTok',
  device: 'this device',
  deviceHevc: 'this device (HEVC)',
  landscape: 'landscape 16:9',
  standard: 'standard 4:3',
  youtubeAv1: 'YouTube Shorts (AV1)',
  deviceAv1: 'this device (AV1)',
  square: 'Square (1:1)',
  portrait: 'Portrait (4:5)',
  square2160: '2160p master (1:1)',
  portrait2160: '2160p master (4:5)',
  master4k: '4K master (9:16)',
  landscape4k: '4K master (16:9)',
};
const MUSIC: Readonly<Record<RenderFacts['music'], string>> = {
  none: 'no music',
  platformSound: "the platform's sound added later",
  ownTrack: 'their own music track',
  referenceAudio: "the reference's audio",
  generated: 'generated music',
};

const named = (name: string) => `“${name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name}”`;

/** The item's words: model-facing and shown in Settings as written. */
export function whatWorkedText(facts: RenderFacts, exports: number): string {
  const look = facts.styleName ? ` with the ${named(facts.styleName)} look` : '';
  const cuts = facts.transitions.length > 0 ? `${facts.transitions.join(', ')} transitions` : 'straight cuts';
  const times = exports === 1 ? 'once' : `${exports} times`;
  return (
    `${named(facts.templateName)} (version ${facts.templateVersion})${look} reached a finished export for ` +
    `${PRESETS[facts.presetId]}: ${facts.clips} clips in ${facts.seconds} s, ${cuts}, captions ` +
    `${facts.captions ? 'on' : 'off'}, ${MUSIC[facts.music]}. Exported ${times}.`
  );
}

export interface WhatWorkedDeps {
  readonly facts: (renderId: RenderId) => AsyncResult<RenderFacts | undefined>;
  readonly store: Pick<MemoryStore, 'list'>;
  /** Core's command bus, by name (memory.create, memory.update). */
  readonly commands: {
    dispatch(
      name: string,
      payload: unknown,
      origin: CommandOrigin,
      options?: DispatchOptions,
    ): AsyncResult<unknown>;
  };
  readonly settings: Pick<SettingsStore, 'get' | 'set'>;
  /** The latest renders, newest first (core's RenderStore.list). */
  readonly renders: {
    list(filter: {
      readonly limit: number;
    }): AsyncResult<readonly Pick<RenderRecord, 'id' | 'status' | 'finishedAt'>[]>;
  };
}

export type WhatWorkedOutcome = 'created' | 'updated' | 'recorded-before' | 'no-template';

export interface WhatWorkedRecorder {
  /** Records one finished render. */
  record(renderId: RenderId): AsyncResult<WhatWorkedOutcome>;
  /** Records the ready renders that finished after the watermark, oldest first. */
  catchUp(): AsyncResult<number>;
}

export function createWhatWorkedRecorder(deps: WhatWorkedDeps): WhatWorkedRecorder {
  async function existing(facts: RenderFacts): AsyncResult<MemoryItemView | undefined> {
    const items = await deps.store.list({
      scopes: [{ kind: 'template', templateId: facts.templateId }],
      dataKind: 'what-worked',
    });
    if (!items.ok) return items;
    return ok(
      items.value.find((item) => item.data?.kind === 'what-worked' && item.data.styleId === facts.styleId),
    );
  }

  async function record(renderId: RenderId): AsyncResult<WhatWorkedOutcome> {
    const read = await deps.facts(renderId);
    if (!read.ok) return read;
    const facts = read.value;
    if (!facts) return ok('no-template');
    const outcome = await recordFacts(facts);
    if (!outcome.ok) return outcome;
    // A live export moves the watermark too, so a catch-up after a restart doesn't count it again.
    const seen = await deps.settings.get(WHAT_WORKED_SEEN_SETTING);
    if (!seen.ok) return seen;
    if (facts.finishedAt > seen.value) {
      const moved = await deps.settings.set(WHAT_WORKED_SEEN_SETTING, facts.finishedAt);
      if (!moved.ok) return moved;
    }
    return outcome;
  }

  async function recordFacts(facts: RenderFacts): AsyncResult<WhatWorkedOutcome> {
    const { renderId } = facts;
    const found = await existing(facts);
    if (!found.ok) return found;
    const before = found.value?.data?.kind === 'what-worked' ? found.value.data : undefined;
    if (before?.renderId === renderId) return ok('recorded-before');
    const exports = (before?.exports ?? 0) + 1;
    const data = {
      kind: 'what-worked' as const,
      templateVersion: facts.templateVersion,
      styleId: facts.styleId,
      presetId: facts.presetId,
      renderId,
      exports,
    };
    const text = whatWorkedText(facts, exports);
    const options = { idempotencyKey: `memory.whatWorked:${renderId}` };
    const done = found.value
      ? await deps.commands.dispatch(
          MEMORY_COMMANDS.update,
          { memoryId: found.value.id, baseRevision: found.value.revision, patch: { text, data } },
          ORIGIN,
          options,
        )
      : await deps.commands.dispatch(
          MEMORY_COMMANDS.create,
          {
            memoryId: newId<'MemoryItem'>(),
            item: {
              scope: { kind: 'template', templateId: facts.templateId },
              text,
              source: 'learned',
              data,
            },
          },
          ORIGIN,
          options,
        );
    if (!done.ok) return done;
    return ok(found.value ? 'updated' : 'created');
  }

  async function catchUp(): AsyncResult<number> {
    const seen = await deps.settings.get(WHAT_WORKED_SEEN_SETTING);
    if (!seen.ok) return seen;
    const renders = await deps.renders.list({ limit: CATCH_UP_LIMIT });
    if (!renders.ok) return renders;
    const missed = renders.value
      .filter((render) => render.status === 'ready' && (render.finishedAt ?? 0) > seen.value)
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    let recorded = 0;
    for (const render of missed) {
      const outcome = await record(render.id);
      if (!outcome.ok) return outcome;
      if (outcome.value === 'created' || outcome.value === 'updated') recorded++;
      const moved = await deps.settings.set(WHAT_WORKED_SEEN_SETTING, render.finishedAt ?? seen.value);
      if (!moved.ok) return moved;
    }
    return ok(recorded);
  }

  return { record, catchUp };
}
