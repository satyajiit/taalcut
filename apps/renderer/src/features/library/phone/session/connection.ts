// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the phone flow says about the Wi-Fi session, worked out from what the transfer service streams
 * (transfer SPEC, "Sessions"): starting, waiting for a phone, connected, a phone that stopped sending part-way
 * (its uploads paused), stopped and why, or a start that failed. Pure, so the tabs, the band and the index
 * redirect agree.
 */
import type { TaalcutError, TransferDevice, TransferFile, TransferSession } from '@taalcut/core';
import type { TransferState } from '../use-transfer-session';

export type StopReason = NonNullable<TransferSession['stopReason']>;

export type Connection =
  /** Nothing asked the Mac to listen yet (the flow's Wi-Fi tab hasn't been opened). */
  | { readonly kind: 'off' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'failed'; readonly error: TaalcutError }
  | { readonly kind: 'stopped'; readonly reason: StopReason | undefined }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'connected'; readonly devices: readonly TransferDevice[] }
  /** Its uploads paused and nothing else moves: the phone locked, slept or left the Wi-Fi. */
  | { readonly kind: 'lost'; readonly device: TransferDevice | null };

/** Files still travelling or being added: what the Transfers tab counts. */
const ON_THE_WAY: ReadonlySet<TransferFile['state']> = new Set([
  'uploading',
  'paused',
  'checking',
  'importing',
]);
const LANDED: ReadonlySet<TransferFile['state']> = new Set(['imported', 'duplicate']);

export const isOnTheWay = (file: TransferFile): boolean => ON_THE_WAY.has(file.state);
export const hasLanded = (file: TransferFile): boolean => LANDED.has(file.state);

export function onTheirWay(files: readonly TransferFile[]): number {
  return files.filter(isOnTheWay).length;
}

export function connectionOf(
  state: Pick<TransferState, 'session' | 'files' | 'error'> & { readonly enabled?: boolean },
): Connection {
  const { session, files, error } = state;
  if (state.enabled === false) return { kind: 'off' };
  // A stream that failed, before the session or after it, means nothing listens any more: say so, with its fix.
  if (error) return { kind: 'failed', error };
  if (!session) return { kind: 'starting' };
  if (session.state === 'stopped') return { kind: 'stopped', reason: session.stopReason };
  if (session.state === 'starting') return { kind: 'starting' };
  const paused = files.filter((file) => file.state === 'paused');
  if (paused.length > 0 && !files.some((file) => file.state === 'uploading')) {
    const deviceId = paused[0]?.deviceId;
    return { kind: 'lost', device: session.devices.find((device) => device.id === deviceId) ?? null };
  }
  if (session.devices.length > 0) return { kind: 'connected', devices: session.devices };
  return { kind: 'waiting' };
}

export type PhoneTab = 'wifi' | 'cable' | 'transfers' | 'help';

/**
 * Where /library/phone lands: Transfers while a phone is connected, files are on their way or a cable import
 * started here is running; Wi-Fi otherwise (the first visit: its code is the quickest way in).
 */
export function landingTab(
  state: Pick<TransferState, 'session' | 'files' | 'error'>,
  cableRunning: boolean,
): PhoneTab {
  if (cableRunning || onTheirWay(state.files) > 0) return 'transfers';
  const connection = connectionOf(state);
  return connection.kind === 'connected' || connection.kind === 'lost' ? 'transfers' : 'wifi';
}

export type StepState = 'done' | 'current' | 'next';

/**
 * The three steps beside the QR as beats (DESIGN.md, first run's rail): scan, Allow it on the computer (UX3; a
 * phone that typed the code and PIN skips it), pick clips. A connected phone has done the first two; once everything
 * it sent has landed, the third is done too.
 */
export function stepStates(
  connection: Connection,
  files: readonly TransferFile[],
): readonly [StepState, StepState, StepState] {
  if (connection.kind !== 'connected' && connection.kind !== 'lost') return ['current', 'next', 'next'];
  const landed = files.some(hasLanded) && onTheirWay(files) === 0;
  return ['done', 'done', landed ? 'done' : 'current'];
}
