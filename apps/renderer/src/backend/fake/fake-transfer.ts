// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Wi-Fi import (`appContract.transfer`) as the renderer's fake serves it. The
 * real server is @taalcut/transfer in the lan process; it listens exactly as
 * long as `open`'s stream is open, and so does this fake: `listening` is true
 * from the first item until the page stops reading. A scripted phone pairs
 * and sends four files (one a smaller copy iOS re-encoded, one already in the
 * library). Scenarios cover the screen's other states; `startMs` holds the
 * first item back, as the lan process takes a moment to start. In 'approval'
 * (UX3) the phone asks first, and only Allow lets it in (fake-transfer-approval.ts).
 */
import {
  newId,
  toRpcError,
  UnknownError,
  type EventBus,
  type Id,
  type TransferFile,
  type TransferPairing,
  type TransferSession,
  type TransferStreamItem,
} from '@taalcut/core';
import { createFakeApproval } from './fake-transfer-approval';

export const TRANSFER_SCENARIOS = [
  'phone',
  'waiting',
  'no-network',
  'blocked',
  'local-network-denied',
  'idle',
  // UX1 (the phone flow): a slow start held forever, a phone that pairs and sends nothing, uploads that stop
  // part-way (the phone went away), a wrong PIN five times, the port taken, the imports drive unplugged, a start
  // that fails outright, no Wi-Fi until the third look at the interfaces, and a stream that fails after it
  // listened (the lan process went away for good: it fails again after the screen's one reopen).
  'starting',
  'connected',
  'lost',
  'reset',
  'bind-failed',
  'originals-offline',
  'error',
  'network-back',
  'dropped',
  // UX3: the phone that scanned the QR asks to pair, and only the person's Allow on the computer lets it in.
  'approval',
] as const;
export type TransferScenario = (typeof TRANSFER_SCENARIOS)[number];

export interface FakeTransferOptions {
  readonly scenario?: TransferScenario;
  /** How fast the scripted phone goes: 2 is twice as fast. */
  readonly speed?: number;
  /** Milliseconds before the first item, as the lan process starts. */
  readonly startMs?: number;
  /** 'approval': how long the phone's request waits for an answer. Default 60 s, as the server's. */
  readonly approvalTtlMs?: number;
}

const ADDRESS = '192.168.1.24';
const PORT = 52817;
const IDLE_MS = 10 * 60_000;

const FILES: readonly { name: string; size: number; reencode?: true; duplicate?: true }[] = [
  { name: 'IMG_8812.MOV', size: 412_000_000 },
  { name: 'IMG_8813.MOV', size: 96_400_000, reencode: true },
  { name: 'IMG_8815.HEIC', size: 3_100_000 },
  { name: 'IMG_8790.MOV', size: 58_000_000, duplicate: true },
];

/** Scenarios whose session stops before it listens, and why. */
const STOPS_AT_ONCE: Partial<Record<TransferScenario, NonNullable<TransferSession['stopReason']>>> = {
  'no-network': 'no-network',
  'bind-failed': 'bind-failed',
  'originals-offline': 'originals-offline',
};

/** Scenarios where no phone ever pairs: the session just listens. */
const QUIET: ReadonlySet<TransferScenario> = new Set(['waiting', 'reset', 'network-back', 'dropped']);

function pairing(round: number): TransferPairing {
  const codes = ['7KD2M9QX', 'H4TQ8W2N', 'R6YB3PZK'];
  const pins = ['482913', '730254', '196407'];
  return {
    qrText: `http://${ADDRESS}:${PORT}/#k=t${round}Qm9vbS1yZWVsLXRva2VuLWZha2U`,
    code: codes[round % codes.length]!,
    pin: pins[round % pins.length]!,
  };
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export function createFakeTransfer(events: EventBus, options: FakeTransferOptions = {}) {
  const scenario = options.scenario ?? 'phone';
  const pace = 1 / Math.max(0.1, options.speed ?? 1);
  let session: TransferSession | null = null;
  let files: TransferFile[] = [];
  let round = 0;
  let listening = false;
  const log = { opens: 0, closes: 0 };
  /** Wakes the open stream when something changes outside it (disconnect, cancel, new pairing). */
  let poke: (() => void) | null = null;
  let pendingPairing: TransferPairing | null = null;
  /** How often the screen looked for a network ('network-back' finds one on the third look). */
  let interfaceLooks = 0;
  const approval = createFakeApproval(options.approvalTtlMs ?? 60_000);

  const publish = (next: TransferSession) => {
    session = next;
    events.emit('transfer.session', next);
  };

  function start(): TransferSession {
    const now = Date.now();
    return {
      id: newId<'TransferSession'>(),
      state: 'listening',
      url: `http://${ADDRESS}:${PORT}`,
      network: {
        interface: 'en0',
        address: ADDRESS,
        reachable:
          scenario === 'blocked'
            ? 'blocked'
            : scenario === 'local-network-denied'
              ? 'local-network-denied'
              : 'yes',
      },
      idleStopAt: now + IDLE_MS,
      pairingResets: 0,
      devices: [],
      totals: { files: 0, done: 0, failed: 0, bytes: 0, bytesDone: 0 },
      startedAt: now,
    };
  }

  function totals(): TransferSession['totals'] {
    const done = files.filter((f) => f.state === 'imported' || f.state === 'duplicate').length;
    const failed = files.filter((f) => f.state === 'failed' || f.state === 'rejected').length;
    return {
      files: files.length,
      done,
      failed,
      bytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
      bytesDone: files.reduce((sum, f) => sum + f.receivedBytes, 0),
    };
  }

  function stop(reason: NonNullable<TransferSession['stopReason']>) {
    if (!session || session.state === 'stopped') return;
    listening = false;
    publish({ ...session, state: 'stopped', stopReason: reason });
  }

  /** One step of the scripted phone: pair, then move every file on. Returns the items to send. */
  function advance(step: number): TransferStreamItem[] {
    if (!session || session.state !== 'listening') return [];
    const out: TransferStreamItem[] = [];
    const now = Date.now();
    if (step === 6 && session.devices.length === 0) {
      publish({
        ...session,
        devices: [
          {
            id: newId<'TransferDevice'>(),
            label: 'iPhone',
            platform: 'ios',
            connectedAt: now,
            lastSeenAt: now,
          },
        ],
      });
      out.push({ type: 'session', session: session! });
    }
    const device = session!.devices[0];
    if (step === 9 && device && files.length === 0 && scenario !== 'connected') {
      files = FILES.map((file) => ({
        id: newId<'TransferUpload'>(),
        sessionId: session!.id,
        deviceId: device.id,
        name: file.name,
        sizeBytes: file.size,
        receivedBytes: 0,
        state: 'uploading',
        updatedAt: now,
      }));
    }
    files = files.map((file, index) => {
      const plan = FILES[index]!;
      // 'lost': the phone went away mid-upload (locked, out of range); its uploads wait to resume.
      if (scenario === 'lost' && step >= 12 && file.state === 'uploading') {
        const { bytesPerSecond: _speed, etaMs: _eta, ...still } = file;
        return { ...still, state: 'paused', updatedAt: now };
      }
      if (file.state === 'uploading') {
        const rate = 28_000_000 + index * 9_000_000;
        const received = Math.min(file.sizeBytes, file.receivedBytes + rate * 0.4);
        const left = file.sizeBytes - received;
        return received >= file.sizeBytes
          ? { ...file, receivedBytes: file.sizeBytes, state: 'checking', updatedAt: now }
          : {
              ...file,
              receivedBytes: received,
              bytesPerSecond: rate,
              etaMs: Math.round((left / rate) * 1000),
              updatedAt: now,
            };
      }
      if (file.state === 'checking')
        return {
          ...file,
          state: plan.duplicate ? 'duplicate' : 'importing',
          ...(plan.reencode
            ? {
                reencode: {
                  verdict: 'likely' as const,
                  reasons: ['ios-browser', 'h264-aac', 'no-camera-metadata'] as const,
                },
              }
            : { reencode: { verdict: 'unlikely' as const, reasons: ['hevc', 'camera-metadata'] as const } }),
          ...(plan.duplicate ? { assetId: '01K7C5M6Q810000000000003G2' as Id<'Asset'> } : {}),
          updatedAt: now,
        };
      if (file.state === 'importing')
        return { ...file, state: 'imported', assetId: newId<'Asset'>(), updatedAt: now };
      return file;
    });
    for (const file of files) {
      if (file.updatedAt === now) {
        out.push({ type: 'file', file });
        events.emit('transfer.file', file);
      }
    }
    if (files.length > 0) {
      const active = files.some((f) => ['uploading', 'checking', 'importing'].includes(f.state));
      publish({ ...session!, totals: totals(), ...(active ? { idleStopAt: now + IDLE_MS } : {}) });
      out.push({ type: 'session', session: session! });
    }
    return out;
  }

  async function* open(signal?: AbortSignal): AsyncGenerator<TransferStreamItem, void, undefined> {
    log.opens += 1;
    // A second open ends the first (stopReason 'replaced').
    stop('replaced');
    files = [];
    approval.reset();
    round += 1;
    if (options.startMs) await sleep(options.startMs, signal);
    if (scenario === 'starting') {
      // Held at the start until the page stops reading: the skeletons stay.
      await new Promise<void>((resolve) => {
        if (!signal || signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return;
    }
    if (scenario === 'error') throw toRpcError(UnknownError());
    const stopsAtOnce =
      scenario === 'network-back' && log.opens === 1 ? 'no-network' : STOPS_AT_ONCE[scenario];
    if (stopsAtOnce) {
      const stopped: TransferSession = { ...start(), state: 'stopped', stopReason: stopsAtOnce };
      delete (stopped as { url?: string }).url;
      delete (stopped as { network?: unknown }).network;
      publish(stopped);
      yield { type: 'session', session: stopped };
      return;
    }
    publish(start());
    listening = true;
    yield { type: 'session', session: session!, pairing: pairing(round) };
    try {
      for (let step = 1; !signal?.aborted && session?.state === 'listening'; step += 1) {
        await Promise.race([
          // A request waiting for an answer lapses on time, not on the next step.
          sleep(Math.min(400 * pace, approval.lapsesIn()), signal),
          new Promise<void>((resolve) => {
            poke = resolve;
          }),
        ]);
        poke = null;
        if (signal?.aborted) break;
        if (pendingPairing) {
          yield { type: 'session', session: session!, pairing: pendingPairing };
          pendingPairing = null;
        }
        if (scenario === 'idle' && step >= 4) {
          stop('idle');
          yield { type: 'session', session: session! };
          return;
        }
        if (scenario === 'dropped' && step >= 3) throw toRpcError(UnknownError());
        if (scenario === 'reset' && step === 3) {
          // Five wrong PINs: the server replaces the token, code and PIN, and the screen warns.
          round += 1;
          publish({ ...session!, pairingResets: session!.pairingResets + 1 });
          yield { type: 'session', session: session!, pairing: pairing(round) };
          continue;
        }
        if (QUIET.has(scenario)) {
          yield { type: 'session', session: session! };
          continue;
        }
        if (scenario === 'approval') {
          const { changed, phoneStep } = approval.step(step, session!.id);
          if (changed) yield { type: 'approval', approval: changed };
          const moved = phoneStep === null ? [] : advance(phoneStep);
          for (const item of moved) yield item;
          // Nothing new: the session as it is, as the quiet scenarios send it.
          if (!changed && moved.length === 0) yield { type: 'session', session: session! };
          continue;
        }
        for (const item of advance(step)) yield item;
      }
    } finally {
      // The page stopped reading (left the screen, closed the window): the server stops listening.
      stop('closed');
    }
  }

  return {
    open,
    close(sessionId: Id<'TransferSession'>) {
      log.closes += 1;
      const closed = session?.id === sessionId && session.state !== 'stopped';
      if (closed) stop('closed');
      poke?.();
      return { closed };
    },
    newPairing() {
      round += 1;
      pendingPairing = pairing(round);
      if (session) publish({ ...session, pairingResets: session.pairingResets });
      poke?.();
      return pendingPairing;
    },
    answerApproval(approvalId: Id<'TransferApproval'>, allow: boolean) {
      const answered = approval.answer(approvalId, allow);
      poke?.();
      return answered;
    },
    disconnect(deviceId: Id<'TransferDevice'>) {
      if (session) publish({ ...session, devices: session.devices.filter((d) => d.id !== deviceId) });
      poke?.();
      return session!;
    },
    cancelUpload(uploadId: Id<'TransferUpload'>) {
      files = files.map((f) =>
        f.id === uploadId && f.state === 'uploading'
          ? { ...f, state: 'cancelled', updatedAt: Date.now() }
          : f,
      );
      const file = files.find((f) => f.id === uploadId)!;
      events.emit('transfer.file', file);
      poke?.();
      return file;
    },
    interfaces: () => {
      interfaceLooks += 1;
      if (scenario === 'no-network' || (scenario === 'network-back' && interfaceLooks < 3)) return [];
      return [{ name: 'en0', address: ADDRESS }];
    },
    /** What the e2e driver reads: is the server listening, and how often was it opened and closed. */
    state: () => ({ listening, opens: log.opens, closes: log.closes, session, approval: approval.current() }),
  };
}

export type FakeTransfer = ReturnType<typeof createFakeTransfer>;
