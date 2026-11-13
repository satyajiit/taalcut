// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect } from 'react';
import { useBackend } from '../backend/backend';
import type { Backend } from '../backend/contract';
import { useDownloads } from '../features/downloads/downloads-store';
import { useDownloadActions } from '../features/downloads/use-download-actions';

/** First run asks once per backend: coming back to a step after a cancel doesn't start it again. */
const asked = new WeakSet<Backend>();

/**
 * Everything this Mac needs starts downloading the moment first run's steps open (UX4: the Mac is checked quietly).
 * The download is chosen by this Mac's tier on the other side, so nothing here asks the person anything; the steps'
 * sidebar keeps it in view ("Getting ready"), and anything that needs the person surfaces on the last step.
 */
export function useQuietStart(): void {
  const backend = useBackend();
  const { downloads } = useDownloads();
  const { start } = useDownloadActions();
  const missing = downloads?.state === 'missing';
  useEffect(() => {
    if (!missing || asked.has(backend)) return;
    asked.add(backend);
    start();
  }, [missing, backend, start]);
}
