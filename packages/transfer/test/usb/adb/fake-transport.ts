// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory adb transport. Speaks sync v1 and `exec:` so the real Adb client
 * can list, pull, and hash without a phone or a server. The transcript records
 * opcodes only: a failure must not print a path.
 */
import { createHash } from 'node:crypto';
import {
  AdbBanner,
  type AdbFeature,
  type AdbIncomingSocketHandler,
  type AdbSocket,
  type AdbTransport,
} from '@yume-chan/adb';
// pnpm does not hoist this transitive dependency. AdbSocket is typed with these classes.
import {
  ReadableStream,
  WritableStream,
  type MaybeConsumable,
} from '../../../../../node_modules/.pnpm/@yume-chan+stream-extra@2.6.1/node_modules/@yume-chan/stream-extra';
import {
  concat,
  concatAll,
  DIR_MODE,
  done,
  encode,
  fail,
  FILE_MODE,
  fileData,
  ID,
  packet,
  readU32,
  stat,
  u32,
} from './sync-wire';

export interface FakeFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mtime: number;
}

export interface FakeRow {
  readonly id: string;
  readonly name: string;
  readonly size: number | null;
  readonly dateAdded: number | null;
  /** MediaStore `datetaken`, ms. Absent: the column is null for this row. */
  readonly dateTaken?: number | null;
  readonly bucket: string | null;
  readonly mime: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
}

export interface FakeAdbOptions {
  readonly files: readonly FakeFile[];
  readonly rows?: readonly FakeRow[];
  readonly content?: 'ok' | 'fail';
  /** `false`: an Android 9 files table, which refuses a `datetaken` projection. */
  readonly dateTakenColumn?: boolean;
  readonly sha256sum?: 'ok' | 'missing' | 'error';
  /** The cable comes out when the phone gets this many LIST requests (1-based). */
  readonly unplugAtList?: number;
}

export interface FakeAdb {
  readonly transport: AdbTransport;
  readonly transcript: readonly string[];
}

interface DirNode {
  readonly kind: 'dir';
  readonly name: string;
  readonly mtime: number;
  readonly children: Map<string, Node>;
}
interface FileNode {
  readonly kind: 'file';
  readonly name: string;
  readonly mtime: number;
  readonly bytes: Uint8Array;
}
type Node = DirNode | FileNode;

export function createFakeAdb(options: FakeAdbOptions): FakeAdb {
  const transcript: string[] = [];
  const root: DirNode = { kind: 'dir', name: '', mtime: 0, children: new Map() };
  for (const file of options.files) insert(root, file);
  const closers = new Set<() => void>();
  let markDisconnected: () => void = () => undefined;
  const disconnected = new Promise<void>((resolve) => {
    markDisconnected = resolve;
  });
  const banner = new AdbBanner('device', 'sdk', 'Pixel', 'pixel', []);
  const clientFeatures: readonly AdbFeature[] = [];
  let lists = 0;
  const unplug = (): void => {
    for (const close of closers) close();
    closers.clear();
    markDisconnected();
  };
  const onList = (): boolean => {
    lists += 1;
    if (options.unplugAtList === undefined || lists < options.unplugAtList) return false;
    unplug();
    return true;
  };

  const transport: AdbTransport = {
    serial: 'adb',
    maxPayloadSize: 64 * 1024,
    banner,
    disconnected,
    clientFeatures,
    connect(service: string): AdbSocket {
      if (service === 'sync:') return openSync(root, transcript, closers, onList);
      if (service.startsWith('exec:'))
        return openExec(service.slice('exec:'.length), root, options, transcript, closers);
      return openExec('', root, options, transcript, closers);
    },
    addReverseTunnel(_handler: AdbIncomingSocketHandler, address?: string): string {
      return address ?? 'localabstract:taalcut';
    },
    removeReverseTunnel(_address: string): void {},
    clearReverseTunnels(): void {},
    close(): Promise<void> {
      unplug();
      return Promise.resolve();
    },
  };
  return { transport, transcript };
}

function openSync(
  root: DirNode,
  transcript: string[],
  closers: Set<() => void>,
  onList: () => boolean,
): AdbSocket {
  let pending: Uint8Array = new Uint8Array(0);
  let enqueue: (bytes: Uint8Array) => void = () => undefined;
  const pipe = createPipe('sync:', closers, (chunk) => {
    pending = concat(pending, chunk);
    pending = drain(pending, root, transcript, enqueue, onList);
  });
  enqueue = (bytes) => pipe.enqueue(bytes);
  return pipe.socket;
}

function drain(
  pending: Uint8Array,
  root: DirNode,
  transcript: string[],
  enqueue: (bytes: Uint8Array) => void,
  onList: () => boolean,
): Uint8Array {
  let rest = pending;
  while (rest.byteLength >= 8) {
    const request = readU32(rest, 0);
    const length = readU32(rest, 4);
    if (length > 4096) {
      enqueue(fail('EINVAL'));
      return new Uint8Array(0);
    }
    if (rest.byteLength < 8 + length) return rest;
    const path = new TextDecoder().decode(rest.subarray(8, 8 + length));
    rest = rest.subarray(8 + length).slice();
    // Unplugged: every socket has ended, so the request gets no answer at all.
    if (request === ID.list && onList()) return new Uint8Array(0);
    enqueue(respond(request, path, root, transcript));
  }
  return rest;
}

function respond(request: number, path: string, root: DirNode, transcript: string[]): Uint8Array {
  const node = lookup(root, path);
  if (request === ID.list) {
    transcript.push('LIST');
    if (!node || node.kind !== 'dir') return fail('ENOENT');
    const dents = [...node.children.values()].map((child) => dent(child));
    return concat(concatAll(dents), done(16));
  }
  if (request === ID.recv) {
    transcript.push('RECV');
    if (!node || node.kind !== 'file') return fail('ENOENT');
    return concat(fileData(node.bytes), done(4));
  }
  if (request === ID.stat) {
    transcript.push('STAT');
    if (!node) return stat(0, 0, 0);
    return stat(
      node.kind === 'dir' ? DIR_MODE : FILE_MODE,
      node.kind === 'file' ? node.bytes.byteLength : 0,
      node.mtime,
    );
  }
  transcript.push('SYNC');
  return fail('ENOSYS');
}

function openExec(
  command: string,
  root: DirNode,
  options: FakeAdbOptions,
  transcript: string[],
  closers: Set<() => void>,
): AdbSocket {
  const pipe = createPipe('exec:', closers, () => undefined);
  pipe.enqueue(execBytes(command, root, options, transcript));
  pipe.end();
  return pipe.socket;
}

function execBytes(
  command: string,
  root: DirNode,
  options: FakeAdbOptions,
  transcript: string[],
): Uint8Array {
  if (command.startsWith('sha256sum ')) {
    transcript.push('EXEC sha256sum');
    if (options.sha256sum === 'missing') return encode('sha256sum: not found\n');
    if (options.sha256sum === 'error') return encode('sha256sum: read error: I/O error\n');
    const node = lookup(root, unquote(command.slice('sha256sum '.length)));
    if (!node || node.kind !== 'file') return encode('No such file\n');
    return encode(`${createHash('sha256').update(node.bytes).digest('hex')}\n`);
  }
  if (command.startsWith('content ')) {
    transcript.push('EXEC content-query');
    if (options.content === 'fail') return encode('Error: Permission Denial\n');
    const projection = projectionOf(command);
    if (options.dateTakenColumn === false && projection.includes('datetaken')) {
      return encode(
        'Error while accessing provider:media\njava.lang.IllegalArgumentException: Invalid column datetaken\n',
      );
    }
    const lines = (options.rows ?? []).map((row, index) => formatRow(row, index, projection));
    return encode(lines.length > 0 ? `${lines.join('\n')}\n` : '');
  }
  transcript.push('EXEC other');
  return encode('command not found\n');
}

interface Pipe {
  readonly socket: AdbSocket;
  enqueue(bytes: Uint8Array): void;
  end(): void;
}

function createPipe(service: string, closers: Set<() => void>, onWrite: (chunk: Uint8Array) => void): Pipe {
  const held: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      held.controller = controller;
    },
  });
  const controller = held.controller;
  if (!controller) throw new Error('adb-socket');
  let markClosed: (value: undefined) => void = () => undefined;
  const closed = new Promise<undefined>((resolve) => {
    markClosed = resolve;
  });
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    closers.delete(end);
    try {
      controller.close();
    } catch {
      // The client may already have cancelled the readable.
    }
    markClosed(undefined);
  };
  closers.add(end);
  const writable = new WritableStream<MaybeConsumable<Uint8Array>>({
    write(chunk) {
      onWrite(copyChunk(chunk));
    },
  });
  return {
    socket: {
      service,
      readable,
      writable,
      closed,
      close(): Promise<void> {
        end();
        return Promise.resolve();
      },
    },
    enqueue(bytes: Uint8Array): void {
      if (!ended && bytes.byteLength > 0) controller.enqueue(bytes);
    },
    end,
  };
}

function copyChunk(chunk: MaybeConsumable<Uint8Array>): Uint8Array {
  // A different module instance of Consumable must still be released, or the writer hangs.
  if (!(chunk instanceof Uint8Array)) return chunk.tryConsume((value) => value.slice());
  return chunk.slice();
}

function insert(root: DirNode, file: FakeFile): void {
  const parts = file.path.split('/').filter((part) => part.length > 0);
  const name = parts[parts.length - 1];
  if (!name) return;
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    const existing = dir.children.get(part);
    if (existing?.kind === 'dir') {
      dir = existing;
      continue;
    }
    const next: DirNode = { kind: 'dir', name: part, mtime: file.mtime, children: new Map() };
    dir.children.set(part, next);
    dir = next;
  }
  dir.children.set(name, { kind: 'file', name, mtime: file.mtime, bytes: file.bytes });
}

function lookup(root: DirNode, path: string): Node | undefined {
  const parts = path.split('/').filter((part) => part.length > 0);
  let current: Node = root;
  for (const part of parts) {
    if (current.kind !== 'dir') return undefined;
    const next = current.children.get(part);
    if (!next) return undefined;
    current = next;
  }
  return parts.length > 0 ? current : root;
}

/** The columns asked for, in order, the way `content query --projection a:b:c` takes them. */
function projectionOf(command: string): readonly string[] {
  const tokens = command.split(' ').map(unquote);
  const at = tokens.indexOf('--projection');
  const value = at >= 0 ? tokens[at + 1] : undefined;
  return value ? value.split(':') : [];
}

function formatRow(row: FakeRow, index: number, projection: readonly string[]): string {
  const field = (value: number | null | undefined): string =>
    value === null || value === undefined ? 'null' : String(value);
  const text = (value: string | null): string => value ?? 'null';
  const columns: Readonly<Record<string, string>> = {
    _id: row.id,
    _display_name: row.name,
    _size: field(row.size),
    date_added: field(row.dateAdded),
    datetaken: field(row.dateTaken),
    bucket_display_name: text(row.bucket),
    mime_type: text(row.mime),
    width: field(row.width),
    height: field(row.height),
    duration: field(row.duration),
  };
  const fields = projection.map((column) => `${column}=${columns[column] ?? 'null'}`);
  return `Row: ${index} ${fields.join(', ')}`;
}

function unquote(token: string): string {
  const quoted = token.length >= 2 && token.startsWith("'") && token.endsWith("'");
  return quoted ? token.slice(1, -1).replaceAll(`'\\''`, "'") : token;
}

function dent(node: Node): Uint8Array {
  const name = encode(node.name);
  const size = node.kind === 'file' ? node.bytes.byteLength : 0;
  const mode = node.kind === 'dir' ? DIR_MODE : FILE_MODE;
  return packet(ID.dent, concatAll([u32(mode), u32(size), u32(node.mtime), u32(name.byteLength), name]));
}
