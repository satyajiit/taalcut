// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type SoakMode } from '../result';
import { type SoakApp, type SoakClock, type SoakScenario, type SoakSink } from '../scenario';
import {
  RENDER_EARLY_FROM,
  RENDER_EARLY_TO,
  RENDER_LATE_FROM,
  RENDER_LATE_TO,
  scoreRenderGrowth,
  type RenderWindows,
  type SoakRssSample,
} from '../score';

export const FULL_RENDERS = 50;
export const SMOKE_RENDERS = 2;

export interface RenderSchedule extends RenderWindows {
  count: number;
}

/**
 * Full mode compares renders 41–50 with 6–15. Smoke only calls renderOnce twice,
 * so it compares those two renders with the same scorer. The windows are the override;
 * the loop is not copied.
 */
export function renderSchedule(mode: SoakMode): RenderSchedule {
  if (mode === 'smoke') return { count: SMOKE_RENDERS, earlyFrom: 1, earlyTo: 1, lateFrom: 2, lateTo: 2 };
  return {
    count: FULL_RENDERS,
    earlyFrom: RENDER_EARLY_FROM,
    earlyTo: RENDER_EARLY_TO,
    lateFrom: RENDER_LATE_FROM,
    lateTo: RENDER_LATE_TO,
  };
}

async function runRenders(app: SoakApp, clock: SoakClock, sink: SoakSink, mode: SoakMode): Promise<void> {
  const schedule = renderSchedule(mode);
  for (let index = 1; index <= schedule.count; index += 1) {
    const rendered = await app.renderOnce();
    if (!rendered.probed) sink.fail(`invalid-render:${rendered.id}`);
    const reading = await app.sample();
    sink.recordSample({
      at: clock.now(),
      renderIndex: index,
      processes: reading.processes,
      dbBytes: reading.dbBytes,
      queueDepth: reading.queueDepth,
    });
  }
}

export const rendersScenario: SoakScenario = {
  id: 'renders-50',
  hours: 0,
  checks: ['render-probed', 'memory-growth', 'integrity'],
  run: runRenders,
  score(samples: readonly SoakRssSample[], mode: SoakMode) {
    const schedule = renderSchedule(mode);
    return scoreRenderGrowth(samples, schedule);
  },
};
