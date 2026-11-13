// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createSerialQueue } from '@taalcut/core';
import type {
  TransferApproval,
  TransferApprovalId,
  TransferDeviceId,
  TransferFile,
  TransferPairing,
  TransferSession,
  TransferSessionId,
  TransferStreamItem,
  TransferUploadId,
} from '@taalcut/core';
import { SessionClosed } from './errors';
import { journalPath } from './handoff/journal';
import { createHandoff } from './handoff/run';
import { isBindableAddress, type LanInterface } from './network';
import { createDeviceStore } from './pairing/devices';
import { createRateLimiter } from './pairing/rate';
import { systemRandom } from './pairing/secrets';
import { createUploadIndex } from './store/uploads';
import type { TransferDeps } from './deps';
import type { SessionBox } from './session/box';
import { answerApproval } from './session/approvals';
import { createHost } from './session/http-api';
import { toFile, toPairing, toSession, type LiveFile, type LiveSession } from './session/live';
import {
  armIdle,
  blankSession,
  boot,
  diskFree,
  emitFile,
  emitSession,
  rotateSecrets,
  stopSession,
} from './session/machine';
import { toRecord } from './session/tus-hooks';

const KEEP = new Set(['imported', 'duplicate', 'checking', 'importing', 'failed', 'rejected']);

export interface TransferService {
  open(input: { interface?: string }, signal: AbortSignal): AsyncIterable<TransferStreamItem>;
  close(sessionId: TransferSessionId): Promise<{ closed: boolean }>;
  newPairing(sessionId: TransferSessionId): Promise<TransferPairing>;
  /** UX3: a person's Allow or Deny for a phone that asked to pair with the QR. */
  answerApproval(
    sessionId: TransferSessionId,
    approvalId: TransferApprovalId,
    allow: boolean,
  ): Promise<TransferApproval>;
  disconnect(sessionId: TransferSessionId, deviceId: TransferDeviceId): Promise<TransferSession>;
  cancelUpload(sessionId: TransferSessionId, uploadId: TransferUploadId): Promise<TransferFile>;
  interfaces(): Promise<LanInterface[]>;
  forgetDevices(): Promise<{ forgotten: number }>;
  drained(): Promise<void>;
}

export function createTransferService(deps: TransferDeps): TransferService {
  const box = {} as SessionBox;
  let ready: Promise<void> | null = null;
  /** Session changes one at a time, in the order asked. */
  const gate = createSerialQueue();
  const random = deps.random ?? systemRandom();
  const devices = createDeviceStore(deps.stateDir);
  const uploads = createUploadIndex(deps.stateDir);
  const rates = createRateLimiter(() => deps.clock.now());
  const handoff = createHandoff(deps, {
    device(file) {
      const live = box.current?.devices.get(file.deviceId);
      return {
        label: live?.label ?? 'Phone',
        platform: live?.platform ?? 'other',
        userAgent: file.userAgent || live?.userAgent || '',
      };
    },
    update(file) {
      void uploads.save(toRecord(file, file.receivedAt));
      box.emitFile(file, true);
    },
    note(line) {
      box.log(line);
    },
  });
  Object.assign(box, {
    deps,
    random,
    devices,
    uploads,
    rates,
    handoff,
    current: null,
    stop: (session: LiveSession, reason: Parameters<SessionBox['stop']>[1]) =>
      stopSession(box, session, reason),
    armIdle: (session: LiveSession) => armIdle(box, session),
    emitFile: (file: LiveFile, force: boolean) => emitFile(box, file, force),
    emitSession: (session: LiveSession, pairing: boolean) => emitSession(box, session, pairing),
    diskFree: (dir: string) => diskFree(box, dir),
    log: (line: string) => deps.log?.info(line),
  });
  box.host = createHost(box);

  function init(): Promise<void> {
    ready ??= mkdir(deps.stateDir, { recursive: true })
      .then(() => Promise.all([devices.load(), uploads.load()]))
      .then(() => undefined);
    return ready;
  }

  async function begin(requested?: string): Promise<LiveSession> {
    await init();
    if (box.current && !box.current.stopReason) await box.stop(box.current, 'replaced');
    const session = blankSession(random, deps.clock.now());
    box.current = session;
    try {
      await boot(box, session, requested);
    } catch {
      box.log('bind failed');
      await box.stop(session, 'bind-failed');
    }
    return session;
  }

  function requireLive(sessionId: TransferSessionId): LiveSession {
    const session = box.current;
    if (!session || session.id !== sessionId || session.stopReason) throw SessionClosed();
    return session;
  }

  return {
    async *open(input, signal) {
      const session = await gate.run(() => begin(input.interface));
      const onAbort = () => {
        void box.stop(session, 'closed');
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        if (signal.aborted) await box.stop(session, 'closed');
        for (;;) {
          const next = await session.queue.next();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        if (box.current === session && !session.stopReason) await box.stop(session, 'closed');
      }
    },
    close(sessionId) {
      return gate.run(async () => {
        const session = box.current;
        if (!session || session.id !== sessionId) throw SessionClosed();
        if (session.stopReason) {
          await session.stopping;
          return { closed: false };
        }
        await box.stop(session, 'closed');
        return { closed: true };
      });
    },
    newPairing(sessionId) {
      return gate.run(async () => {
        const session = requireLive(sessionId);
        rotateSecrets(session, random);
        box.emitSession(session, true);
        return toPairing(session);
      });
    },
    answerApproval(sessionId, approvalId, allow) {
      return gate.run(() => answerApproval(box, requireLive(sessionId), approvalId, allow));
    },
    disconnect(sessionId, deviceId) {
      return gate.run(async () => {
        const session = requireLive(sessionId);
        session.devices.delete(deviceId);
        await devices.remove(deviceId);
        box.emitSession(session, false);
        return toSession(session);
      });
    },
    cancelUpload(sessionId, uploadId) {
      return gate.run(() => cancel(box, requireLive(sessionId), uploadId));
    },
    async interfaces() {
      return deps.network
        .candidates()
        .filter((item) => isBindableAddress(item.address, deps.allowLoopback === true))
        .slice(0, 16);
    },
    forgetDevices() {
      return gate.run(async () => {
        const forgotten = await devices.forget();
        if (box.current && !box.current.stopReason) {
          box.current.devices.clear();
          box.emitSession(box.current, false);
        }
        return { forgotten };
      });
    },
    drained: () => handoff.drained(),
  };
}

async function cancel(box: SessionBox, session: LiveSession, uploadId: TransferUploadId) {
  const file = session.files.get(uploadId);
  if (!file) throw SessionClosed();
  if (KEEP.has(file.state)) return toFile(file);
  box.deps.importSink.space?.release(file.id);
  file.state = 'cancelled';
  await session.store?.remove(file.id).catch(() => undefined);
  await rm(join(session.stagingDir, file.id), { force: true });
  await rm(join(session.stagingDir, `${file.id}.json`), { force: true });
  await rm(journalPath(session.stagingDir, file.id), { force: true });
  await box.uploads.save(toRecord(file, box.deps.clock.now()));
  box.emitFile(file, true);
  box.log(`cancel ${file.id} ${file.ext} ${file.sizeBytes}`);
  return toFile(file);
}
