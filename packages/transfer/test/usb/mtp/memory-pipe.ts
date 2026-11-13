// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory MTP responder. Records the operation codes and partial reads the initiator sent.
 * Object bodies are read lazily, so a 5 GiB object costs nothing until a range of it is asked for.
 */
import {
  DATATYPE_UINT64,
  FORMAT_ASSOCIATION,
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
  TYPE_COMMAND,
  TYPE_DATA,
  TYPE_RESPONSE,
} from '../../../src/bridges/mtp/codes';
import {
  concatBytes,
  decodeContainer,
  encodeContainer,
  encodeIdArray,
  encodeObjectInfo,
  encodeParams,
  encodeUint64,
  parseParams,
} from '../../../src/bridges/mtp/container';
import type { ClaimResult, MtpPipe, PipeStatus } from '../../../src/bridges/mtp/session';

export interface MemoryBody {
  readonly size: number;
  read(offset: number, length: number): Uint8Array;
}

export interface MemoryObject {
  readonly handle: number;
  readonly storageId: number;
  readonly parent: number;
  readonly format: number;
  readonly name: string;
  readonly created: string;
  readonly modified: string;
  readonly body: MemoryBody;
  readonly width: number;
  readonly height: number;
}

export interface MemoryPipeOptions {
  readonly claim?: ClaimResult;
  readonly stallOnPartial?: boolean;
  readonly partial64Unsupported?: boolean;
  readonly sessionAlreadyOpen?: boolean;
  /** Emulate a locked Android phone that answers GetStorageIDs with an empty list. */
  readonly noStorage?: boolean;
  /** GetObjectPropValue for ObjectSize (default true). */
  readonly propValue?: boolean;
  /** GetObjectPropList for ObjectSize (default false). */
  readonly propList?: boolean;
  /** Most bytes one bulk-in transfer returns (default: whatever was asked). */
  readonly maxTransfer?: number;
  /** The cable comes out when this object's chunk at `offset` is asked for; `onGone` runs first. */
  readonly disconnectAt?: { readonly handle: number; readonly offset: number; readonly onGone: () => void };
}

export interface MemoryPipe extends MtpPipe {
  readonly opcodes: readonly number[];
  /** Every partial read: the object and the offset asked for. */
  readonly reads: readonly { readonly handle: number; readonly offset: number }[];
  readonly transactions: readonly number[];
}

export function bytesBody(bytes: Uint8Array): MemoryBody {
  return { size: bytes.byteLength, read: (offset, length) => bytes.subarray(offset, offset + length) };
}

/** The byte at `position` of a patterned body: what a test expects without holding the object. */
export function patternByte(seed: number, position: number): number {
  return (position * 31 + seed + Math.floor(position / 65_536)) & 0xff;
}

export function patternBody(size: number, seed: number): MemoryBody {
  return {
    size,
    read(offset, length) {
      const end = Math.min(size, offset + length);
      const out = new Uint8Array(Math.max(0, end - offset));
      for (let index = 0; index < out.byteLength; index += 1) out[index] = patternByte(seed, offset + index);
      return out;
    },
  };
}

export function folder(handle: number, parent: number, name: string): MemoryObject {
  return {
    handle,
    storageId: 1,
    parent,
    format: FORMAT_ASSOCIATION,
    name,
    created: '',
    modified: '',
    body: bytesBody(new Uint8Array()),
    width: 0,
    height: 0,
  };
}

export function createMemoryPipe(
  objects: readonly MemoryObject[],
  options: MemoryPipeOptions = {},
): MemoryPipe {
  const opcodes: number[] = [];
  const reads: { handle: number; offset: number }[] = [];
  const transactions: number[] = [];
  const queue: Uint8Array[] = [];
  let gone = false;
  const byHandle = new Map(objects.map((object) => [object.handle, object]));

  const unplugIfDue = (code: number, params: readonly number[]): void => {
    const cut = options.disconnectAt;
    if (!cut || gone || (code !== OP_GET_PARTIAL_OBJECT_64 && code !== OP_GET_PARTIAL_OBJECT)) return;
    if (params[0] === cut.handle && partialOffset(code, params) >= cut.offset) {
      gone = true;
      cut.onGone();
    }
  };

  return {
    opcodes,
    reads,
    transactions,
    claim: () => Promise.resolve(options.claim ?? 'claimed'),
    cancelRequest: () => Promise.resolve(),
    release: () => Promise.resolve(),
    async transferOut(data): Promise<PipeStatus> {
      if (gone) return 'gone';
      const command = decodeContainer(data);
      if (!command || command.type !== TYPE_COMMAND) return 'stall';
      const params = parseParams(command.payload);
      opcodes.push(command.code);
      transactions.push(command.transactionId);
      if (command.code === OP_GET_PARTIAL_OBJECT_64 || command.code === OP_GET_PARTIAL_OBJECT)
        reads.push({ handle: params[0] ?? 0, offset: partialOffset(command.code, params) });
      unplugIfDue(command.code, params);
      if (gone) return 'gone';
      const replies = respond(command.code, command.transactionId, params, byHandle, options);
      if (options.stallOnPartial && command.code === OP_GET_PARTIAL_OBJECT_64) {
        const first = replies[0];
        if (first && first.byteLength > 8) queue.push(first.subarray(0, 8));
        return 'ok';
      }
      for (const reply of replies) queue.push(reply);
      return 'ok';
    },
    async transferIn(length) {
      if (gone) return { data: new Uint8Array(), status: 'gone' as const };
      const next = queue[0];
      if (!next) return { data: new Uint8Array(), status: 'stall' as const };
      const take = Math.min(length, options.maxTransfer ?? length, next.byteLength);
      const data = next.subarray(0, take);
      if (take === next.byteLength) queue.shift();
      else queue[0] = next.subarray(take);
      return { data, status: 'ok' as const };
    },
  };
}

function partialOffset(code: number, params: readonly number[]): number {
  if (code === OP_GET_PARTIAL_OBJECT_64) return (params[1] ?? 0) + (params[2] ?? 0) * 0x1_0000_0000;
  return params[1] ?? 0;
}

function respond(
  code: number,
  transactionId: number,
  params: readonly number[],
  objects: ReadonlyMap<number, MemoryObject>,
  options: MemoryPipeOptions,
): Uint8Array[] {
  if (code === OP_OPEN_SESSION) {
    const status = options.sessionAlreadyOpen ? RES_SESSION_ALREADY_OPEN : RES_OK;
    return [response(status, transactionId)];
  }
  if (code === OP_CLOSE_SESSION) return [response(RES_OK, transactionId)];
  if (code === OP_GET_STORAGE_IDS) {
    if (options.noStorage) return data(code, transactionId, encodeIdArray([]));
    const ids = [...new Set([...objects.values()].map((object) => object.storageId))];
    return data(code, transactionId, encodeIdArray(ids.length > 0 ? ids : [1]));
  }
  if (code === OP_GET_OBJECT_HANDLES) {
    const storage = params[0] ?? 0;
    const rawParent = params[2] ?? 0;
    const parent = rawParent === 0xffff_ffff ? 0 : rawParent;
    const ids = [...objects.values()]
      .filter((object) => object.storageId === storage && (rawParent === 0 || object.parent === parent))
      .map((object) => object.handle);
    return data(code, transactionId, encodeIdArray(ids));
  }
  const object = objects.get(params[0] ?? 0);
  if (code === OP_GET_OBJECT_INFO && object) return data(code, transactionId, objectInfo(object));
  if (code === OP_GET_OBJECT_PROP_VALUE && object && options.propValue !== false) {
    if (params[1] !== PROP_OBJECT_SIZE) return [response(RES_OPERATION_NOT_SUPPORTED, transactionId)];
    return data(code, transactionId, encodeUint64(object.body.size));
  }
  if (code === OP_GET_OBJECT_PROP_LIST && object && options.propList === true) {
    const element = concatBytes([
      encodeParams([1, object.handle]),
      Uint8Array.of(PROP_OBJECT_SIZE & 0xff, PROP_OBJECT_SIZE >> 8, DATATYPE_UINT64, 0),
      encodeUint64(object.body.size),
    ]);
    return data(code, transactionId, element);
  }
  if (code === OP_GET_PARTIAL_OBJECT_64 && options.partial64Unsupported) {
    return [response(RES_OPERATION_NOT_SUPPORTED, transactionId)];
  }
  if ((code === OP_GET_PARTIAL_OBJECT_64 || code === OP_GET_PARTIAL_OBJECT) && object) {
    const max = code === OP_GET_PARTIAL_OBJECT_64 ? (params[3] ?? 0) : (params[2] ?? 0);
    return data(code, transactionId, object.body.read(partialOffset(code, params), max));
  }
  if (code === OP_GET_THUMB) return [response(RES_OPERATION_NOT_SUPPORTED, transactionId)];
  return [response(RES_OPERATION_NOT_SUPPORTED, transactionId)];
}

function objectInfo(object: MemoryObject): Uint8Array {
  return encodeObjectInfo({
    storageId: object.storageId,
    format: object.format,
    size: object.body.size,
    width: object.width,
    height: object.height,
    parent: object.parent,
    name: object.name,
    created: object.created,
    modified: object.modified,
  });
}

function data(code: number, transactionId: number, payload: Uint8Array): Uint8Array[] {
  return [encodeContainer(TYPE_DATA, code, transactionId, payload), response(RES_OK, transactionId)];
}

function response(code: number, transactionId: number): Uint8Array {
  return encodeContainer(TYPE_RESPONSE, code, transactionId, new Uint8Array());
}
