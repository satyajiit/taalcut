// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * This install's own star ratings (P3-V8), so a template's detail shows what the person gave it after a restart.
 * Kept as one setting: the Worker holds only the salted hash of the install key, so it can't be asked which
 * templates this install rated. A rating is written with the command that sent it.
 */
import {
  defineSetting,
  hubIdSchema,
  ok,
  type AsyncResult,
  type CommandContext,
  type HubTemplateId,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';

/** Far more templates than one person rates; the setting stays a small JSON value. */
const MAX_MY_RATINGS = 5_000;

export const HUB_MY_RATINGS_SETTING = defineSetting(
  'hub.myRatings',
  z
    .record(hubIdSchema, z.int().min(1).max(5))
    .refine((ratings) => Object.keys(ratings).length <= MAX_MY_RATINGS),
  {},
);

export interface MyRatings {
  get(hubId: HubTemplateId): AsyncResult<number | null>;
  /** Null withdraws the rating. */
  set(hubId: HubTemplateId, stars: number | null, context?: CommandContext): AsyncResult<void>;
}

export function createSettingsMyRatings(settings: Pick<SettingsStore, 'get' | 'set'>): MyRatings {
  return {
    async get(hubId) {
      const all = await settings.get(HUB_MY_RATINGS_SETTING);
      return all.ok ? ok(all.value[hubId] ?? null) : all;
    },
    async set(hubId, stars, context) {
      const all = await settings.get(HUB_MY_RATINGS_SETTING);
      if (!all.ok) return all;
      const { [hubId]: _previous, ...others } = all.value;
      const next = stars === null ? others : { ...others, [hubId]: stars };
      const saved = await settings.set(HUB_MY_RATINGS_SETTING, next, context);
      return saved.ok ? ok(undefined) : saved;
    },
  };
}
