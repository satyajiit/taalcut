// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One MTP session over an injected pipe. One transaction at a time.
 *
 * - OpenSession goes out as transaction 0 and the next operation is 1: PTP (ISO 15740) gives the
 *   OpenSession operation itself TransactionID 0x00000000 (libgphoto2's ptp_opensession does the same).
 * - GetPartialObject64 falls back to GetPartialObject when the phone refuses it; the refusal is
 *   remembered for the session. An object of 4 GiB or more can't be read without the 64-bit operation.
 * - ObjectInfo's size is 32 bits. For 0xFFFFFFFF (4 GiB or more) the real size comes from ObjectSize
 *   (GetObjectPropValue, else GetObjectPropList); without it the object is listed but never pulled.
 * - A pipe that reports `gone` (the cable came out) is DeviceGone, so the run pauses instead of failing.
 */
import { createSerialQueue, err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { BridgeFailed, DeviceGone, ShortRead } from '../../usb/errors';
import {
  FOUR_GIB,
  OP_CLOSE_SESSION,
  OP_GET_OBJECT_HANDLES,
  OP_GET_OBJECT_INFO,
  OP_GET_OBJECT_PROP_LIST,
  OP_GET_OBJECT_PROP_VALUE,
  OP_GET_PARTIAL_OBJECT,
  OP_GET_PARTIAL_OBJECT_64,
  OP_GET_STORAGE_IDS,
  OP_GET_THUMB,
  OP_OPEN_SESSION,
  PROP_OBJECT_SIZE,
  RES_OK,
  RES_OPERATION_NOT_SUPPORTED,
  RES_SESSION_ALREADY_OPEN,
  TYPE_DATA,
  TYPE_RESPONSE,
  responseCode,
} from './codes';
import {
  decodeContainer,
  encodeCommand,
  parseIdArray,
  parseObjectInfo,
  parsePropListUint64,
  parseUint64,
  type ObjectInfo,
  type PtpContainer,
} from './container';
import { Inbox } from './inbox';

/** `busy`: something else holds the interface (the camera agent). `gone`: the device left the bus. */
export type ClaimResult = 'claimed' | 'busy' | 'gone' | 'failed';
export type PipeStatus = 'ok' | 'stall' | 'gone';

export interface MtpPipe {
  claim(signal: AbortSignal): Promise<ClaimResult>;
  transferOut(data: Uint8Array, signal: AbortSignal): Promise<PipeStatus>;
  transferIn(
    length: number,
    signal: AbortSignal,
  ): Promise<{ readonly data: Uint8Array; readonly status: PipeStatus }>;
  /** The still-image class Cancel Request for this transaction. */
  cancelRequest(transactionId: number): Promise<void>;
  release(): Promise<void>;
}

const MAX_CONTAINER = 2 * 1024 * 1024;
const OPEN_SESSION_TRANSACTION = 0;
const SESSION_ID = 1;
const CLOSE_MS = 2_000;

interface Reply {
  readonly code: number;
  readonly payload: Uint8Array;
}

export interface MtpSession {
  open(signal: AbortSignal): AsyncResult<void>;
  storageIds(signal: AbortSignal): AsyncResult<readonly number[]>;
  handles(storageId: number, parent: number, signal: AbortSignal): AsyncResult<readonly number[]>;
  info(handle: number, signal: AbortSignal): AsyncResult<ObjectInfo>;
  thumb(handle: number, signal: AbortSignal): AsyncResult<Uint8Array | null>;
  readAt(
    handle: number,
    offset: number,
    length: number,
    objectSize: number,
    signal: AbortSignal,
  ): AsyncResult<Uint8Array>;
  /** Cancels the transaction in flight, if any. */
  cancel(): Promise<void>;
  /** CloseSession (at most 2 s), then the interface is released whatever the phone answered. */
  close(): Promise<void>;
}

export function createMtpSession(pipe: MtpPipe): MtpSession {
  /** One transaction at a time: the phone answers them in turn. */
  const transactions = createSerialQueue();
  let transaction = 1;
  let inFlight: number | null = null;
  let closing = false;
  let closePromise: Promise<void> | null = null;
  const inbox = new Inbox();
  let partial64 = true;
  const infos = new Map<number, ObjectInfo>();

  function exchange(code: number, params: readonly number[], signal: AbortSignal, fixedId?: number) {
    return transactions.run(() => once(code, params, signal, fixedId));
  }

  async function cancelInFlight(id: number): Promise<void> {
    await pipe.cancelRequest(id);
    inbox.clear();
  }

  async function once(
    code: number,
    params: readonly number[],
    signal: AbortSignal,
    fixedId: number | undefined,
  ): AsyncResult<Reply> {
    if ((closing && code !== OP_CLOSE_SESSION) || signal.aborted) return err(DeviceGone());
    const id = fixedId ?? transaction++;
    inFlight = id;
    inbox.clear();
    try {
      const sent = await pipe.transferOut(encodeCommand(code, id, params), signal);
      if (signal.aborted) {
        await cancelInFlight(id);
        return err(DeviceGone());
      }
      if (sent === 'gone') return err(DeviceGone());
      if (sent === 'stall') return err(ShortRead());
      const first = await readOne(id, signal);
      if (!first.ok) {
        inbox.clear();
        return first;
      }
      if (first.value.type === TYPE_RESPONSE)
        return ok({ code: first.value.code, payload: new Uint8Array() });
      if (first.value.type !== TYPE_DATA) {
        inbox.clear();
        return err(BridgeFailed(undefined, { detail: 'container' }));
      }
      const response = await readOne(id, signal);
      if (!response.ok) {
        inbox.clear();
        return response;
      }
      if (response.value.type !== TYPE_RESPONSE) {
        inbox.clear();
        return err(BridgeFailed(undefined, { detail: 'container' }));
      }
      return ok({ code: response.value.code, payload: first.value.payload });
    } finally {
      inFlight = null;
    }
  }

  async function readOne(id: number, signal: AbortSignal): AsyncResult<PtpContainer> {
    let emptyPackets = 0;
    for (;;) {
      if (signal.aborted) {
        await cancelInFlight(id);
        return err(DeviceGone());
      }
      const length = inbox.peekUint32();
      if (length !== null) {
        if (length < 12 || length > MAX_CONTAINER) return err(ShortRead());
        if (inbox.length >= length) {
          const decoded = decodeContainer(inbox.take(length));
          if (!decoded) return err(ShortRead());
          if (decoded.transactionId !== id) continue;
          return ok(decoded);
        }
      }
      const need = length === null ? 1024 : length - inbox.length;
      const aligned = Math.ceil(Math.max(1024, Math.min(need, 1024 * 1024)) / 1024) * 1024;
      const got = await pipe.transferIn(aligned, signal);
      if (signal.aborted) {
        await cancelInFlight(id);
        return err(DeviceGone());
      }
      if (got.status === 'gone') return err(DeviceGone());
      if (got.status === 'stall') return err(ShortRead());
      // USB bulk endpoints send a zero-length packet (ZLP) after a transfer that is a multiple of wMaxPacketSize.
      if (got.data.byteLength === 0) {
        emptyPackets += 1;
        if (emptyPackets > 2) return err(ShortRead());
        continue;
      }
      emptyPackets = 0;
      inbox.push(got.data);
    }
  }

  /** ObjectSize for an object whose 32-bit size is 0xFFFFFFFF. Optional operations that fail leave it unknown. */
  async function realSize(handle: number, info: ObjectInfo, signal: AbortSignal): AsyncResult<ObjectInfo> {
    const value = await exchange(OP_GET_OBJECT_PROP_VALUE, [handle, PROP_OBJECT_SIZE], signal);
    if (!value.ok && DeviceGone.is(value.error)) return value;
    const fromValue = value.ok && value.value.code === RES_OK ? parseUint64(value.value.payload) : null;
    if (fromValue !== null) return ok({ ...info, size: fromValue, sizeKnown: true });
    const list = await exchange(OP_GET_OBJECT_PROP_LIST, [handle, 0, PROP_OBJECT_SIZE, 0, 0], signal);
    if (!list.ok && DeviceGone.is(list.error)) return list;
    const fromList =
      list.ok && list.value.code === RES_OK
        ? parsePropListUint64(list.value.payload, handle, PROP_OBJECT_SIZE)
        : null;
    if (fromList !== null) return ok({ ...info, size: fromList, sizeKnown: true });
    return ok(info);
  }

  return {
    async open(signal) {
      const opened = await exchange(OP_OPEN_SESSION, [SESSION_ID], signal, OPEN_SESSION_TRANSACTION);
      if (!opened.ok) return opened;
      if (opened.value.code === RES_OK || opened.value.code === RES_SESSION_ALREADY_OPEN)
        return ok(undefined);
      return err(BridgeFailed(undefined, { detail: responseCode(opened.value.code) }));
    },
    async storageIds(signal) {
      return idsOf(await exchange(OP_GET_STORAGE_IDS, [], signal));
    },
    async handles(storageId, parent, signal) {
      // ISO 15740 / MTP 1.1: 0xFFFFFFFF asks for objects at the root of the storage; 0x00000000
      // asks for every object across the whole storage recursively.
      const parentHandle = parent === 0 ? 0xffff_ffff : parent;
      return idsOf(await exchange(OP_GET_OBJECT_HANDLES, [storageId, 0, parentHandle], signal));
    },
    async info(handle, signal) {
      const cached = infos.get(handle);
      if (cached) return ok(cached);
      const result = await exchange(OP_GET_OBJECT_INFO, [handle], signal);
      if (!result.ok) return result;
      if (result.value.code !== RES_OK)
        return err(BridgeFailed(undefined, { detail: responseCode(result.value.code) }));
      const parsed = parseObjectInfo(result.value.payload);
      if (!parsed) return err(ShortRead());
      const sized = parsed.sizeKnown ? ok(parsed) : await realSize(handle, parsed, signal);
      if (!sized.ok) return sized;
      infos.set(handle, sized.value);
      return ok(sized.value);
    },
    async thumb(handle, signal) {
      const result = await exchange(OP_GET_THUMB, [handle], signal);
      if (!result.ok) return DeviceGone.is(result.error) ? result : ok(null);
      if (result.value.code !== RES_OK || result.value.payload.byteLength === 0) return ok(null);
      return ok(result.value.payload);
    },
    async readAt(handle, offset, length, objectSize, signal) {
      const lo = offset % FOUR_GIB;
      const hi = Math.floor(offset / FOUR_GIB);
      if (partial64) {
        const wide = await exchange(OP_GET_PARTIAL_OBJECT_64, [handle, lo, hi, length], signal);
        if (!wide.ok) return wide;
        if (wide.value.code === RES_OK) return ok(wide.value.payload);
        if (wide.value.code !== RES_OPERATION_NOT_SUPPORTED) return payloadOf(wide.value);
        partial64 = false;
      }
      // GetPartialObject's offset is 32 bits: it can't reach the end of an object of 4 GiB or more.
      if (objectSize >= FOUR_GIB) return err(BridgeFailed(undefined, { detail: 'partial64_unsupported' }));
      const narrow = await exchange(OP_GET_PARTIAL_OBJECT, [handle, lo, length], signal);
      if (!narrow.ok) return narrow;
      return payloadOf(narrow.value);
    },
    async cancel() {
      if (inFlight !== null) await cancelInFlight(inFlight);
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        if (inFlight !== null) await cancelInFlight(inFlight).catch(() => undefined);
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), CLOSE_MS);
        try {
          // CloseSession's answer changes nothing: a phone that is gone or silent is released all the same.
          await Promise.race([exchange(OP_CLOSE_SESSION, [], timeout.signal), whenAborted(timeout.signal)]);
        } finally {
          clearTimeout(timer);
          await pipe.release();
        }
      })();
      return closePromise;
    },
  };
}

function payloadOf(reply: Reply): Result<Uint8Array> {
  if (reply.code !== RES_OK) return err(BridgeFailed(undefined, { detail: responseCode(reply.code) }));
  return ok(reply.payload);
}

function idsOf(result: Result<Reply>): Result<readonly number[]> {
  if (!result.ok) return result;
  if (result.value.code !== RES_OK)
    return err(BridgeFailed(undefined, { detail: responseCode(result.value.code) }));
  const ids = parseIdArray(result.value.payload);
  if (!ids) return err(ShortRead());
  return ok(ids);
}

function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
