// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Standing upload consents ("Always allow" on a consent card, PRD G9), by
 * cloud module. The setting moved here from @taalcut/agent unchanged (same key
 * and shape), so background work in the jobs process can read it: indexing
 * jobs (cloud descriptions, cloud speech) run without an agent run and can't
 * show a consent card, so they upload only under a standing consent and
 * otherwise skip and say so.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ok, type AsyncResult } from '../basics/result';
import type { ModelModuleId } from '../ports/model-ports';
import { defineSetting, type SettingsStore } from '../ports/preferences';

export const UPLOAD_CONSENTS_SETTING = defineSetting(
  'agent.uploadConsents',
  z.record(
    z.string(),
    z.object({ id: z.string(), module: z.string(), providers: z.array(z.string()), grantedAt: z.number() }),
  ),
  {},
);

/**
 * The standing consent covering every provider in `providers` for `module`, or null. Never prompts.
 * Background work calls it before each upload and skips the upload on null.
 */
export async function standingUploadConsent(
  settings: Pick<SettingsStore, 'get'>,
  module: ModelModuleId,
  providers: readonly string[],
): AsyncResult<{ readonly consentId: string } | null> {
  const stored = await settings.get(UPLOAD_CONSENTS_SETTING);
  if (!stored.ok) return stored;
  const consent = stored.value[module];
  const covered =
    consent !== undefined && providers.every((provider) => consent.providers.includes(provider));
  return ok(covered ? { consentId: consent.id } : null);
}
