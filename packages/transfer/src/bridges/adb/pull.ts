// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sync RECV from byte 0. adb has no ranged read, so the destination is truncated.
 * Every failure is a value: a gone phone is DeviceGone, a full disk DiskFull.
 * sourceHash is `sha256sum` on the device; a missing command is null, not a failure.
 */
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { escapeArg, type Adb, type AdbSync } from '@yume-chan/adb';
import { DiskFull } from '../../errors';
import { BridgeFailed, DeviceGone } from '../../usb/errors';
import { type PullOptions, type PullResult } from '../../usb/bridge';
import { isAbort, isConnectionGone, isDiskFull, isLocalFileError, PartWriteError } from './failures';

const HASH_LINE = /^([0-9a-fA-F]{64})\b/m;

export async function pullFromDevice(
  adb: Adb,
  remotePath: string,
  options: PullOptions,
): AsyncResult<PullResult> {
  if (options.signal.aborted) return err(CancelledError());
  let sync: AdbSync | undefined;
  let handle: FileHandle | undefined;
  try {
    sync = await adb.sync();
    handle = await open(options.dest, 'w');
    const copied = await copyInto(sync, remotePath, handle, options);
    if (options.signal.aborted) return err(CancelledError());
    await handle.sync();
    return ok({ bytes: copied.bytes, sha256: copied.sha256, ancillary: [] });
  } catch (error) {
    return err(pullFailure(error, options.signal));
  } finally {
    // Cleanup never replaces the pull's own result: the part is fsynced before it closes, and
    // a sync socket that will not close belongs to a phone that is already gone.
    await handle?.close().catch(() => undefined);
    await sync?.dispose().catch(() => undefined);
  }
}

async function copyInto(
  sync: AdbSync,
  remotePath: string,
  handle: FileHandle,
  options: PullOptions,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const hash = createHash('sha256');
  let received = 0;
  const reader = sync.read(remotePath).getReader();
  try {
    while (!options.signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      await writeAll(handle, next.value);
      hash.update(next.value);
      received += next.value.byteLength;
      options.onBytes?.(received);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: received, sha256: hash.digest('hex') };
}

function pullFailure(error: unknown, signal: AbortSignal): TaalcutError {
  if (signal.aborted || isAbort(error)) return CancelledError();
  if (isDiskFull(error)) return DiskFull();
  if (isConnectionGone(error)) return DeviceGone();
  if (error instanceof PartWriteError || isLocalFileError(error))
    return BridgeFailed(undefined, { detail: 'write' });
  return BridgeFailed(undefined, { detail: 'recv' });
}

export async function hashOnDevice(
  adb: Adb,
  remotePath: string,
  signal: AbortSignal,
): AsyncResult<string | null> {
  let ran;
  try {
    ran = await runDeviceShell(adb, ['sha256sum', escapeArg(remotePath)], signal);
  } catch (error) {
    if (signal.aborted || isAbort(error)) return err(CancelledError());
    if (isConnectionGone(error)) return err(DeviceGone());
    return err(BridgeFailed(undefined, { detail: 'sha256sum' }));
  }
  if (ran.aborted) return err(CancelledError());
  const found = HASH_LINE.exec(ran.text);
  const digest = found?.[1];
  if (digest) return ok(digest.toLowerCase());
  if (commandAbsent(ran.text, ran.exitCode)) return ok(null);
  return err(BridgeFailed(undefined, { detail: 'sha256sum' }));
}

export interface ShellText {
  readonly text: string;
  readonly exitCode: number | null;
  readonly aborted: boolean;
}

/** One shell command. Shell v2 when the device has it, otherwise `exec:`. */
export async function runDeviceShell(
  adb: Adb,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ShellText> {
  if (signal.aborted) return { text: '', exitCode: null, aborted: true };
  const shell = adb.subprocess.shellProtocol;
  try {
    if (shell) {
      const proc = await shell.spawn(args, signal);
      const [stdout, stderr, exitCode] = await Promise.all([
        readAll(proc.stdout),
        readAll(proc.stderr),
        proc.exited,
      ]);
      return { text: `${stdout}\n${stderr}`, exitCode, aborted: signal.aborted };
    }
    const proc = await adb.subprocess.noneProtocol.spawn(args, signal);
    const [text] = await Promise.all([readAll(proc.output), proc.exited]);
    return { text, exitCode: null, aborted: signal.aborted };
  } catch (error) {
    if (signal.aborted || isAbort(error)) return { text: '', exitCode: null, aborted: true };
    throw error;
  }
}

function commandAbsent(text: string, exitCode: number | null): boolean {
  if (exitCode === 127) return true;
  return /sha256sum: not found|inaccessible or not found|command not found/i.test(text);
}

/** Every byte reaches the part before it is hashed. A write that takes nothing is an error. */
async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten <= 0) throw new PartWriteError();
    offset += bytesWritten;
  }
}

/** The subprocess streams are the adb package's stream types, not the DOM lib's. */
interface ByteReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
  releaseLock(): void;
}

async function readAll(stream: { getReader(): ByteReader }): Promise<string> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (!value) break;
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(merged);
}
