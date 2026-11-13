// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1's errors, every lane's, declared once here (EAR1-K0 put their catalogue keys, `errors.<code>`, in every
 * locale). A near-silent sound is usually a result (`nearSilent: true`, no verdicts); `ListenNearSilent` is for a
 * caller that asked for something silence can't give.
 */
import { defineError } from '@taalcut/core';

/** A listening model isn't installed; `component` is the id to download. */
export const ListenModelMissing = defineError<{ component: string }>('audio.listen_model_missing');
/** A model or front-end run failed. */
export const ListenFailed = defineError('audio.listen_failed', { retryable: true });
/** Listening can't run here now (no runtime, the process is going away). */
export const ListenUnavailable = defineError<{ reason: string }>('audio.listen_unavailable', {
  retryable: true,
});
/** Nothing to listen to: no audio, a range outside the file, an empty query. */
export const ListenBadInput = defineError('audio.listen_bad_input');
export const ListenNearSilent = defineError('audio.listen_near_silent');
export const SfxBankMissing = defineError('audio.sfx_bank_missing');
export const KitInvalid = defineError('audio.kit_invalid');
export const CloudCritiqueConsentRequired = defineError('audio.cloud_critique_consent_required');
/**
 * EAR1-G1: `sfx.addHits` fromTemplate has no reel effects to place. `reason`: `no_template` (the video follows no
 * template), `no_effects` (its reel had none on its cuts, or wasn't heard), `cuts_changed` (the video's cuts aren't
 * the template's any more), `other`.
 */
export const ReelSfxUnavailable = defineError<{ reason: string }>('audio.reel_sfx_unavailable');
