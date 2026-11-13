// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CDPSession } from '@playwright/test';
import { presentedFrames, type PresentedFrames } from './frame-timing';

/** Electron 45 contentTracing files are protobuf. CDP ReportEvents still exports typed JSON trace events. */
export async function traceCompositor<T>(
  session: CDPSession,
  action: () => Promise<T>,
): Promise<{ value: T; presented: PresentedFrames }> {
  const events: object[] = [];
  const collect = (batch: { value: object[] }) => events.push(...batch.value);
  let complete!: (result: { dataLossOccurred: boolean }) => void;
  const finished = new Promise<{ dataLossOccurred: boolean }>((resolve) => (complete = resolve));
  session.on('Tracing.dataCollected', collect);
  session.on('Tracing.tracingComplete', complete);
  try {
    await session.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: { includedCategories: ['disabled-by-default-devtools.timeline.frame'] },
    });
    let value: T;
    let dataLoss = false;
    try {
      value = await action();
    } finally {
      await session.send('Tracing.end');
      dataLoss = (await finished).dataLossOccurred;
    }
    if (dataLoss) throw new Error('compositor trace lost events');
    return { value, presented: presentedFrames(JSON.stringify(events)) };
  } finally {
    session.off('Tracing.dataCollected', collect);
    session.off('Tracing.tracingComplete', complete);
  }
}
