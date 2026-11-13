// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MTP over ImageCaptureCore's `requestSendPTPCommand` (`devices.ptp` on the mac helper).
 * When macOS's `ptpcamerad` holds `UsbExclusiveOwner` on an Android MTP phone (because Preview,
 * Photos, or Image Capture is open), libusb cannot claim the interface directly and ICC's own
 * `mediaFiles` catalogue is empty. Tunneling MTP containers through `devices.ptp` lets
 * `createMtpSession` walk `DCIM`/`Pictures`/`Movies`, fetch thumbnails, and stream ranged reads.
 */
import type { AsyncResult } from '@taalcut/core';
import type { BridgeDeviceRef, BridgeSession } from '../../usb/bridge';
import { mtpBridgeSession } from '../mtp/bridge';
import { OP_CLOSE_SESSION, OP_OPEN_SESSION, RES_OK, TYPE_DATA, TYPE_RESPONSE } from '../mtp/codes';
import { decodeContainer, encodeContainer } from '../mtp/container';
import { Inbox } from '../mtp/inbox';
import { createMtpSession, type MtpPipe } from '../mtp/session';
import type { HelperEndpoint } from './client';
import { HelperRequestError, isAbortError } from './failures';
import { mapPtpReply } from './map';
import { callHelper } from './session';

export interface PtpBackedSession extends BridgeSession {
  removed: boolean;
  markRemoved(): void;
}

export async function openPtpBackedSession(
  endpoint: HelperEndpoint,
  ref: BridgeDeviceRef,
  isRemoved: () => boolean,
  onClose: (session: PtpBackedSession) => Promise<void>,
  signal: AbortSignal,
): AsyncResult<PtpBackedSession> {
  const inbox = new Inbox();
  const never = new AbortController().signal;
  let inFlight: Promise<unknown> = Promise.resolve();
  let removed = isRemoved();
  const holder: { session?: PtpBackedSession } = {};

  const pipe: MtpPipe = {
    claim: async () => (removed ? 'gone' : 'claimed'),
    async transferOut(data, transferSignal) {
      await inFlight;
      if (removed || isRemoved() || transferSignal.aborted) return 'gone';
      const cmd = decodeContainer(data);
      if (!cmd) return 'stall';
      if (cmd.code === OP_OPEN_SESSION || cmd.code === OP_CLOSE_SESSION) {
        inbox.push(encodeContainer(TYPE_RESPONSE, RES_OK, cmd.transactionId, new Uint8Array()));
        return 'ok';
      }
      try {
        const request = callHelper(
          endpoint,
          'devices.ptp',
          { handle: ref.handle, command: Buffer.from(data).toString('base64') },
          never,
        );
        inFlight = request.then(
          () => undefined,
          () => undefined,
        );
        const payload = await request;
        const reply = mapPtpReply(payload);
        if (!reply || reply.response.byteLength < 12) return 'stall';
        if (reply.data.byteLength > 0) {
          inbox.push(encodeContainer(TYPE_DATA, cmd.code, cmd.transactionId, reply.data));
        }
        const response = new Uint8Array(reply.response);
        new DataView(response.buffer, response.byteOffset, response.byteLength).setUint32(
          8,
          cmd.transactionId,
          true,
        );
        inbox.push(response);
        return 'ok';
      } catch (cause) {
        if (removed || isRemoved() || transferSignal.aborted || isAbortError(cause)) return 'gone';
        if (cause instanceof HelperRequestError && cause.code === 'devices.not_found') return 'gone';
        return 'stall';
      }
    },
    async transferIn(length, transferSignal) {
      if (removed || isRemoved() || transferSignal.aborted) {
        return { data: new Uint8Array(), status: 'gone' };
      }
      if (inbox.length === 0) {
        return { data: new Uint8Array(), status: 'stall' };
      }
      return { data: inbox.take(length), status: 'ok' };
    },
    async cancelRequest() {
      inbox.clear();
    },
    async release() {
      inbox.clear();
      if (!removed && !isRemoved()) {
        await callHelper(
          endpoint,
          'devices.close',
          { handle: ref.handle },
          AbortSignal.timeout(5_000),
        ).catch(() => undefined);
      }
      if (holder.session) await onClose(holder.session);
    },
  };

  const mtp = createMtpSession(pipe);
  const opened = await mtp.open(signal);
  if (!opened.ok) {
    await pipe.release();
    return opened;
  }
  const base = mtpBridgeSession(ref, mtp);
  const session: PtpBackedSession = {
    ...base,
    get removed() {
      return removed;
    },
    set removed(value: boolean) {
      removed = value;
    },
    markRemoved() {
      removed = true;
    },
  };
  holder.session = session;
  return { ok: true, value: session };
}
