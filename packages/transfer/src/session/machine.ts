// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir } from 'node:fs/promises';
import { statfs } from 'node:fs/promises';
import { newId } from '@taalcut/core';
import { TRANSFER_LIMITS } from '../limits';
import { isBindableAddress, type LanInterface } from '../network';
import { createQueue } from './queue';
import { mintPairing, type PairingSecrets } from '../pairing/secrets';
import { createTus } from '../tus/mount';
import { fileSize } from '../store/uploads';
import { join } from 'node:path';
import { closeListener, createListener, readSavedPort, writeSavedPort } from '../http/bind';
import { handleHttp } from '../http/dispatch';
import { selfTestPing } from '../http/self-test';
import type { Reachable } from '../deps';
import type { LiveSession, StopReason } from './live';
import { toFile, toPairing, toSession, type LiveFile } from './live';
import type { SessionBox } from './box';
import { releaseUploadSpace } from './space';
import { tusCallbacks } from './tus-hooks';

export function blankSession(random: SessionBox['random'], now: number): LiveSession {
  return {
    requests: new Set(),
    id: newId<'TransferSession'>(),
    state: 'starting',
    iface: '',
    address: '',
    port: 0,
    secrets: mintPairing(random),
    pairingResets: 0,
    pairFailures: 0,
    startedAt: now,
    idleStopAt: now,
    reachable: 'unknown',
    stagingDir: '',
    volumeName: null,
    devices: new Map(),
    approvals: new Map(),
    files: new Map(),
    queue: createQueue(),
    http: null,
    tus: null,
    store: null,
    unwatch: null,
    idleTimer: null,
  };
}

export function rotateSecrets(session: LiveSession, random: SessionBox['random']): PairingSecrets {
  session.secrets = mintPairing(random);
  session.pairingResets += 1;
  session.pairFailures = 0;
  return session.secrets;
}

export function armIdle(box: SessionBox, session: LiveSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = null;
  if (box.deps.keepReceptionOpen) {
    session.idleStopAt = 0;
    return;
  }
  const now = box.deps.clock.now();
  session.idleStopAt = now + TRANSFER_LIMITS.idleMs;
  session.idleTimer = setTimeout(() => {
    void box.stop(session, 'idle');
  }, TRANSFER_LIMITS.idleMs);
}

export function emitSession(box: SessionBox, session: LiveSession, pairing: boolean): void {
  const view = toSession(session);
  box.deps.events.emit('transfer.session', view);
  const include = pairing && session.state === 'listening';
  session.queue.push({ type: 'session', session: view, ...(include ? { pairing: toPairing(session) } : {}) });
}

export function emitFile(box: SessionBox, file: LiveFile, force: boolean): void {
  const now = box.deps.clock.now();
  if (!force && now - file.lastEmitAt < TRANSFER_LIMITS.progressMinIntervalMs) return;
  file.updatedAt = now;
  file.lastEmitAt = now;
  const view = toFile(file);
  box.deps.events.emit('transfer.file', view);
  box.current?.queue.push({ type: 'file', file: view });
}

export async function diskFree(box: SessionBox, dir: string): Promise<number> {
  if (box.deps.diskFree) return box.deps.diskFree(dir);
  if (box.deps.importSink.space) {
    const place = await box.deps.importSink.staging();
    return place.ok ? place.value.freeBytes : 0;
  }
  const info = await statfs(dir);
  const bytes = info.bavail * info.bsize;
  return Number.isFinite(bytes) ? bytes : Number.MAX_SAFE_INTEGER;
}

export function stopSession(box: SessionBox, session: LiveSession, reason: StopReason): Promise<void> {
  session.stopping ??= finishSession(box, session, reason);
  return session.stopping;
}
async function finishSession(box: SessionBox, session: LiveSession, reason: StopReason): Promise<void> {
  if (session.stopReason) return;
  session.stopReason = reason;
  session.state = 'stopped';
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = null;
  session.unwatch?.();
  session.unwatch = null;
  for (const approval of session.approvals.values()) {
    if (approval.timer) clearInterval(approval.timer);
    approval.timer = null;
    approval.grant = null;
  }
  await closeListener(session.http);
  await Promise.allSettled([...session.requests]);
  await box.handoff.drained();
  session.releaseDestination?.();
  delete session.releaseDestination;
  for (const file of session.files.values()) releaseUploadSpace(box, file);
  session.http = null;
  emitSession(box, session, false);
  session.queue.close();
  await box.devices.flush().catch(() => undefined);
}

export async function boot(box: SessionBox, session: LiveSession, requested?: string): Promise<void> {
  const retained = await box.deps.importSink.retainDestination?.(session.id);
  if (retained && !retained.ok) {
    await box.stop(session, 'originals-offline');
    return;
  }
  if (retained?.ok) session.releaseDestination = retained.value;
  const staging = await box.deps.importSink.staging();
  if (!staging.ok) {
    const offline = staging.error.code === 'library.originals_offline';
    await box.stop(session, offline ? 'originals-offline' : 'bind-failed');
    return;
  }
  session.stagingDir = staging.value.dir;
  session.volumeName = staging.value.volumeName;
  await mkdir(session.stagingDir, { recursive: true });
  const iface = choose(box, requested);
  if (!iface) {
    await box.stop(session, 'no-network');
    return;
  }
  const tus = createTus(session.stagingDir, tusCallbacks(box));
  session.tus = tus.server;
  session.store = tus.store;
  await box.uploads.sweep(session.stagingDir, box.deps.clock.now());
  await tus.store.deleteExpired().catch(() => undefined);
  await dropMissing(box, session.stagingDir);
  session.port = await listen(box, session, iface.address);
  session.address = iface.address;
  session.iface = iface.name;
  await writeSavedPort(box.deps.stateDir, session.port);
  const probe = box.deps.selfTest ?? realSelfTest(box.deps.localNetworkPrivacy);
  session.reachable = await probe(session.address, session.port);
  session.state = 'listening';
  armIdle(box, session);
  session.unwatch = box.deps.network.watch(() => {
    void rebind(box, session);
  });
  emitSession(box, session, true);
}

export function choose(box: SessionBox, requested?: string): LanInterface | null {
  const list = box.deps.network
    .candidates()
    .filter((item) => isBindableAddress(item.address, box.deps.allowLoopback === true));
  if (requested) return list.find((item) => item.name === requested) ?? null;
  return list[0] ?? null;
}

async function listen(box: SessionBox, session: LiveSession, address: string): Promise<number> {
  const saved = await readSavedPort(box.deps.stateDir);
  const span = TRANSFER_LIMITS.portMax - TRANSFER_LIMITS.portMin + 1;
  const ports: number[] = [];
  if (saved !== null) ports.push(saved);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ports.push(TRANSFER_LIMITS.portMin + box.random.int(span));
  }
  let last: unknown;
  for (const port of ports) {
    try {
      session.http = await openSocket(box, session, address, port);
      return port;
    } catch (error) {
      last = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') break;
    }
  }
  throw last instanceof Error ? last : new Error('bind');
}

async function rebind(box: SessionBox, session: LiveSession): Promise<void> {
  if (session.stopReason || box.current !== session || session.state !== 'listening') return;
  const next = choose(box, session.iface) ?? choose(box);
  if (!next || next.address === session.address) return;
  const previous = session.http;
  try {
    const http = await openSocket(box, session, next.address, session.port);
    session.http = http;
    session.address = next.address;
    session.iface = next.name;
    await closeListener(previous);
    const probe = box.deps.selfTest ?? realSelfTest(box.deps.localNetworkPrivacy);
    session.reachable = await probe(session.address, session.port);
    emitSession(box, session, true);
  } catch {
    box.log(`rebind ${session.id} failed`);
  }
}

function openSocket(box: SessionBox, session: LiveSession, address: string, port: number) {
  const bind = box.deps.bind ?? createListener;
  return bind(address, port, (req, res) => {
    const request = handleHttp(box.host, req, res);
    session.requests.add(request);
    void request.finally(() => session.requests.delete(request));
  });
}

async function dropMissing(box: SessionBox, dir: string): Promise<void> {
  for (const record of [...box.uploads.all()]) {
    if (record.finishedAt) continue;
    if ((await fileSize(join(dir, record.id))) === null) await box.uploads.drop(record.id);
  }
}

/** The real self-test, reading a refusal as this OS has it (TransferDeps.localNetworkPrivacy). */
function realSelfTest(localNetworkPrivacy = true): (address: string, port: number) => Promise<Reachable> {
  return (address, port) => selfTestPing(address, port, undefined, localNetworkPrivacy);
}
