// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ONBOARDING_FIRST_EXPORT_STARTS } from '@taalcut/core';
import { useBackendEvents } from '../backend/use-events';
import { msSinceStart } from './started-at';
import { clearMark, readMark, setMark } from './timing-marks';
import { useTelemetry } from './use-onboarding';

type Start = (typeof ONBOARDING_FIRST_EXPORT_STARTS)[number];
const KEY = 'taalcut.onboarding.firstExport';
const STARTS: readonly string[] = ['reference', 'describe', 'template'] satisfies readonly Start[];
const isStart = (value: string | null): value is Start => value !== null && STARTS.includes(value);

/** First run's last step started a chat this way: the first finished export is counted once (section 11). */
export function markFirstExportStart(start: Start): void {
  setMark(KEY, start);
}

function takeStart(): Start | null {
  const start = readMark(KEY);
  if (!isStart(start)) return null;
  clearMark(KEY);
  return start;
}

/**
 * Records `onboarding.firstExport { ms, start }` when the first render after first run finishes ready. Mounted
 * once, app-wide; the agent keeps the event only with usage counts on.
 */
export function FirstExportWatch() {
  const record = useTelemetry();
  useBackendEvents(['render.finished'], (event) => {
    if (event.payload.status !== 'ready') return;
    const ms = msSinceStart();
    const start = ms === null ? null : takeStart();
    if (ms !== null && start) record({ name: 'onboarding.firstExport', ms, start });
  });
  return null;
}
