// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  err,
  fromRpcError,
  ok,
  type AsyncResult,
  type DeviceImportRunId,
  type DeviceReceipt,
  type DeviceRun,
  type ImportItemOutcome,
} from '@taalcut/core';
import type { ImportRunContext } from '@taalcut/library';
import type { PhoneImportCheckpoint, PhoneTransfer } from './phone-types';
import { discoverPhones } from './phone-discovery';

const done = (state: DeviceRun['state']) => ['succeeded', 'failed', 'cancelled'].includes(state);
function outcome(item: DeviceReceipt): ImportItemOutcome {
  const state =
    item.state === 'queued'
      ? 'pending'
      : item.state === 'pulling'
        ? 'receiving'
        : item.state === 'importing'
          ? 'checking'
          : item.state === 'in-icloud' || item.state === 'rejected'
            ? 'failed'
            : item.state;
  return {
    itemId: item.key,
    name: item.name,
    state,
    receivedBytes: item.assetId ? item.sizeBytes : 0,
    result:
      item.assetId && item.sourceId
        ? { kind: 'asset', assetId: item.assetId, sourceId: item.sourceId }
        : null,
    error: item.error,
  };
}
async function receipts(
  transfer: PhoneTransfer,
  runId: DeviceImportRunId,
  context: ImportRunContext,
  seen: Map<string, string>,
  handled?: Set<string>,
) {
  let cursor: string | undefined;
  do {
    const page = await transfer.deviceRunItems({ runId, limit: 500, ...(cursor ? { cursor } : {}) });
    for (const item of page.items) {
      handled?.add(item.key);
      const serial = JSON.stringify(item);
      if (seen.get(item.key) === serial) continue;
      seen.set(item.key, serial);
      context.report(outcome(item));
    }
    cursor = page.nextCursor;
  } while (cursor);
}
async function follow(
  transfer: PhoneTransfer,
  runId: DeviceImportRunId,
  context: ImportRunContext,
  handled: Set<string>,
  byteOffset = 0,
): AsyncResult<number> {
  let received = 0;
  const controller = new AbortController();
  const seen = new Map<string, string>();
  let stopped: ((value: AsyncResult<void>) => void) | undefined;
  const stop = new Promise<AsyncResult<void>>((resolve) => {
    stopped = resolve;
  });
  const onAbort = () => {
    const request =
      context.signal.reason === 'cancel'
        ? transfer.cancelDeviceImport({ runId })
        : transfer.pauseDeviceImport({ runId });
    stopped?.(callRpc(request).then((result) => (result.ok ? ok(undefined) : result)));
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const stream = await transfer.deviceRun({ runId }, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    if (context.signal.aborted) onAbort();
    let totals = '';
    for (;;) {
      const next = await Promise.race([
        iterator.next().then((value) => ({ kind: 'next' as const, value })),
        stop.then(async (result) => ({ kind: 'stop' as const, result: await result })),
      ]);
      if (next.kind === 'stop') {
        await receipts(transfer, runId, context, seen, handled);
        return next.result.ok ? ok(received) : next.result;
      }
      if (next.value.done) return ok(received);
      const run = next.value.value;
      received = run.totals.bytesDone;
      context.progress({
        receivedBytes: byteOffset + run.totals.bytesDone,
        bytesPerSecond: run.bytesPerSecond ?? null,
        etaSeconds: run.etaMs === undefined ? null : run.etaMs / 1000,
      });
      const state = JSON.stringify([run.totals.done, run.totals.failed, run.totals.rejected, run.state]);
      if (state !== totals) {
        totals = state;
        await receipts(transfer, runId, context, seen, handled);
      }
      if (done(run.state)) return ok(received);
    }
  } finally {
    context.signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
export async function runPhoneImport(transfer: PhoneTransfer, context: ImportRunContext): AsyncResult<void> {
  const saved = context.privateData as PhoneImportCheckpoint;
  const controller = new AbortController();
  try {
    await discoverPhones(transfer, controller, saved.deviceKey);
    const opened = await callRpc(
      transfer.openDevice({ deviceKey: saved.deviceKey }, { signal: controller.signal }),
    );
    if (!opened.ok) return opened;
    const handled = new Set<string>();
    let byteOffset = context.session?.progress.receivedBytes ?? 0;
    if (saved.runId) {
      const probe = new AbortController();
      let prior: DeviceRun | undefined;
      try {
        const view = await transfer.deviceRun({ runId: saved.runId }, { signal: probe.signal });
        const entry = await view[Symbol.asyncIterator]().next();
        if (!entry.done) prior = entry.value;
      } finally {
        probe.abort();
      }
      if (prior && !done(prior.state)) {
        const resumed = await callRpc(transfer.resumeDeviceImport({ runId: saved.runId }));
        if (!resumed.ok) return resumed;
        const beforeRun = Math.max(0, byteOffset - prior.totals.bytesDone);
        const result = await follow(transfer, saved.runId, context, handled, beforeRun);
        if (!result.ok) return result;
        if (context.signal.aborted) return ok(undefined);
        byteOffset = beforeRun + result.value;
      }
    }
    const items = context.items.filter((item) => !handled.has(item.item.id));
    for (let offset = 0; offset < items.length; offset += 10000) {
      if (context.signal.aborted) return ok(undefined);
      const include = items.slice(offset, offset + 10000).map((item) => item.item.id);
      const started = await callRpc(
        transfer.importFromDevice({
          deviceKey: saved.deviceKey,
          selection: {
            filter: { onlyNew: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            include,
            exclude: [],
          },
        }),
      );
      if (!started.ok) return started;
      context.checkpoint({ deviceKey: saved.deviceKey, runId: started.value.runId });
      const result = await follow(transfer, started.value.runId, context, handled, byteOffset);
      if (!result.ok) return result;
      if (context.signal.aborted) return ok(undefined);
      byteOffset += result.value;
    }
    return ok(undefined);
  } catch (cause) {
    return err(fromRpcError(cause));
  } finally {
    controller.abort();
  }
}
