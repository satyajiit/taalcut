// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { FakeHubOptions } from '../phase3/hub/hub-state';
import type { AreaOptionsReader } from './area-options';

const STATES = ['online', 'notConfigured', 'localOnly', 'offline'] as const;
const SUBMISSIONS = ['open', 'merged', 'closed', 'hidden'] as const;

/**
 * The hub area's fake options from `taalcut.fake`, key `hub`: `{ state: 'offline' | 'notConfigured' | 'localOnly',
 * rateLimited: true, submission: 'open' | 'merged' | 'closed' | 'hidden' }` (the last for "Golden hour market").
 */
export const hubOptions: AreaOptionsReader = (stored) => {
  const raw = stored['hub'];
  if (!raw || typeof raw !== 'object') return {};
  const given = raw as Record<string, unknown>;
  const state = STATES.find((each) => each === given['state']);
  const submission = SUBMISSIONS.find((each) => each === given['submission']);
  const hub: FakeHubOptions = {
    ...(state ? { state } : {}),
    ...(given['rateLimited'] === true ? { rateLimited: true } : {}),
    ...(submission ? { submission } : {}),
  };
  return { phase3: { hub } };
};
