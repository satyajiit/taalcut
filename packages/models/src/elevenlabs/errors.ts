// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** ElevenLabs errors (SPEC P3.7). Provider failures otherwise map to the models errors in ../errors. */
import { defineError } from '@taalcut/core';
import { openAccounts } from '../errors';

/** The account's plan lacks the API: music on ElevenLabs Free. */
export const ModelPlanRequired = defineError<{ provider: string; feature: string }>('models.plan_required', {
  fix: openAccounts,
});
/** A music plan outside the API's limits, caught before anything is sent. */
export const MusicPlanInvalid = defineError<{ field: string }>('models.music_plan_invalid');
