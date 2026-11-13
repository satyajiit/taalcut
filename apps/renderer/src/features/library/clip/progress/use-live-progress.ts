// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's running steps as their jobs report them (LIB1-PROG). The library names the job of each queued or running
 * step (`stages[].jobId`) and the progress it last saved; the jobs send `job.progress` as they go, by job id. This
 * follows those events for this clip's jobs only, and keeps a clock that moves once a second while a step runs, so
 * the time left counts down between reports. Nothing ticks while nothing runs.
 */
import type { AssetDetail } from '@taalcut/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackendEvents } from '../../../../backend/use-events';
import type { StageClock } from './analysis-estimate';

type Stage = AssetDetail['stages'][number];

const TICK_MS = 1000;

export function useLiveProgress(stages: readonly Stage[]): StageClock {
  const live = useMemo(
    () =>
      new Set<string>(
        stages.flatMap((stage) =>
          stage.jobId && (stage.state === 'running' || stage.state === 'queued') ? [stage.jobId] : [],
        ),
      ),
    [stages],
  );
  const [reported, setReported] = useState<ReadonlyMap<string, number | null>>(new Map());
  useBackendEvents(['job.progress'], ({ payload }) => {
    if (!live.has(payload.jobId)) return;
    setReported((was) => new Map(was).set(payload.jobId, payload.progress.fraction));
  });
  // A job that is no longer this clip's (it finished, or the clip was analysed again) is forgotten.
  useEffect(() => {
    setReported((was) => {
      const kept = [...was].filter(([jobId]) => live.has(jobId));
      return kept.length === was.size ? was : new Map(kept);
    });
  }, [live]);

  const running = stages.some((stage) => stage.state === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  const fractionOf = useCallback(
    (stage: Stage): number | null => {
      const fromEvent = stage.jobId ? reported.get(stage.jobId) : undefined;
      return fromEvent ?? stage.progress ?? null;
    },
    [reported],
  );
  return useMemo(() => ({ now, fractionOf }), [now, fractionOf]);
}
