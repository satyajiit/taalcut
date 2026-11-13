// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Wi-Fi import from a phone (P2-L10): `appContract.transfer`, owner lan
 * (transferRouter in @taalcut/transfer). A session is one opening of the
 * import screen: one listener, one QR, one PIN. Every window sees sessions
 * and files (transfer.session, transfer.file events); only the window that
 * opened the session gets its pairing secrets, and the requests of phones
 * that scanned the QR, which only a person's Allow there lets in (UX3).
 * P3-B4 and P3-B5 add USB import from a connected phone
 * (devices-contract.ts), in the same namespace.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import { reencodeCheckSchema } from '../library/library-types';
import { deviceProcedures } from './devices-contract';
import { TRANSFER_PLATFORMS } from './transfer-platforms';

export { TRANSFER_PLATFORMS };
export const TRANSFER_SESSION_STATES = ['starting', 'listening', 'stopped'] as const;
export const TRANSFER_STOP_REASONS = [
  'closed',
  'idle',
  'replaced',
  'no-network',
  'originals-offline',
  'bind-failed',
] as const;
export const TRANSFER_FILE_STATES = [
  'uploading',
  'paused',
  'checking',
  'importing',
  'imported',
  'duplicate',
  'rejected',
  'failed',
  'cancelled',
] as const;
/**
 * A phone's request to pair (UX3). 'pending' until a person answers on the computer, or it lapses ('expired') or
 * the phone stops asking ('withdrawn': it cancelled, or went quiet).
 */
export const TRANSFER_APPROVAL_STATES = ['pending', 'allowed', 'denied', 'expired', 'withdrawn'] as const;

const count = z.int().nonnegative();
const epochMs = z.int().nonnegative();

export const transferDeviceSchema = z.object({
  id: idSchema<'TransferDevice'>(),
  /** From the phone's browser, e.g. 'iPhone': plain text. */
  label: z.string().max(60),
  platform: z.enum(TRANSFER_PLATFORMS),
  connectedAt: epochMs,
  lastSeenAt: epochMs,
});
export type TransferDevice = z.output<typeof transferDeviceSchema>;

/** A session as every window may see it (transfer.session events): no QR, no PIN. */
export const transferSessionSchema = z.object({
  id: idSchema<'TransferSession'>(),
  state: z.enum(TRANSFER_SESSION_STATES),
  stopReason: z.enum(TRANSFER_STOP_REASONS).optional(),
  /** What the user types on the phone: http://<ip>:<port>. */
  url: z.string().max(60).optional(),
  network: z
    .object({
      interface: z.string().max(32),
      address: z.string().max(45),
      /**
       * The self-test. 'blocked': it timed out (a VPN or security app). 'local-network-denied': refused at once,
       * as with macOS's Local Network permission off; phones can still connect.
       */
      reachable: z.enum(['yes', 'blocked', 'local-network-denied', 'unknown']),
    })
    .optional(),
  /** When the idle stop happens unless something arrives. */
  idleStopAt: epochMs.optional(),
  /** Times the pairing secrets were replaced after failed attempts; the screen warns when it rises. */
  pairingResets: count,
  devices: z.array(transferDeviceSchema).max(8),
  totals: z.object({ files: count, done: count, failed: count, bytes: count, bytesDone: count }),
  startedAt: epochMs,
});
export type TransferSession = z.output<typeof transferSessionSchema>;

/** What only the window that opened the session gets. The renderer draws the QR from `qrText`. */
export const transferPairingSchema = z.object({
  /** The QR's text: url plus '#k=<token>'. Show it only as the QR. */
  qrText: z.string().max(200),
  /** For typing with the short URL when the camera can't scan (Crockford base32). */
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
  /** Typed on the phone with either; never inside the QR. */
  pin: z.string().regex(/^\d{6}$/),
});
export type TransferPairing = z.output<typeof transferPairingSchema>;

/**
 * A phone that opened the QR's link, asking to pair (UX3): only the window that opened the session sees it, and
 * only a person's Allow there pairs the phone. A photo of the QR can ask, never pair.
 */
export const transferApprovalSchema = z.object({
  id: idSchema<'TransferApproval'>(),
  sessionId: idSchema<'TransferSession'>(),
  state: z.enum(TRANSFER_APPROVAL_STATES),
  /** From the phone's browser, e.g. 'iPhone': plain text. */
  device: z.object({ label: z.string().max(60), platform: z.enum(TRANSFER_PLATFORMS) }),
  /** The phone's address on this network, as the computer sees it. */
  address: z.string().max(45),
  /** Two digits the phone shows too, so the person can tell the request is from the phone in their hand. */
  matchCode: z.string().regex(/^\d{2}$/),
  requestedAt: epochMs,
  /** When it lapses unanswered. */
  expiresAt: epochMs,
});
export type TransferApproval = z.output<typeof transferApprovalSchema>;

export const transferFileSchema = z.object({
  id: idSchema<'TransferUpload'>(),
  sessionId: idSchema<'TransferSession'>(),
  deviceId: idSchema<'TransferDevice'>(),
  /** The phone's file name, sanitised: plain text. */
  name: z.string().max(255),
  sizeBytes: count,
  receivedBytes: count,
  state: z.enum(TRANSFER_FILE_STATES),
  bytesPerSecond: count.optional(),
  etaMs: count.optional(),
  reencode: reencodeCheckSchema.optional(),
  /** Once imported, or the asset it duplicated. */
  assetId: idSchema<'Asset'>().optional(),
  error: publicErrorSchema.optional(),
  updatedAt: epochMs,
});
export type TransferFile = z.output<typeof transferFileSchema>;

export const transferStreamItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session'),
    session: transferSessionSchema,
    pairing: transferPairingSchema.optional(),
  }),
  z.object({ type: z.literal('file'), file: transferFileSchema }),
  /** A phone's request to pair, each time its state changes (UX3). */
  z.object({ type: z.literal('approval'), approval: transferApprovalSchema }),
]);
export type TransferStreamItem = z.output<typeof transferStreamItemSchema>;

const sessionId = idSchema<'TransferSession'>();

export const transferContract = {
  /**
   * Starts listening and streams the session: the first item carries `pairing`. The server listens exactly
   * as long as this stream is open; ending it (closing the screen or the window) stops it.
   */
  open: ipc
    .input(z.object({ interface: z.string().max(32).optional() }))
    .output(eventIterator(transferStreamItemSchema)),
  close: ipc.input(z.object({ sessionId })).output(z.object({ closed: z.boolean() })),
  /** New token, code and PIN; the old ones stop working. Paired phones are unaffected. */
  newPairing: ipc.input(z.object({ sessionId })).output(transferPairingSchema),
  /**
   * A person's answer to a phone's request to pair (UX3). Returns the request as it now stands: 'allowed' or
   * 'denied', or 'expired' or 'withdrawn' when the answer came too late.
   */
  answerApproval: ipc
    .input(z.object({ sessionId, approvalId: idSchema<'TransferApproval'>(), allow: z.boolean() }))
    .output(transferApprovalSchema),
  disconnect: ipc
    .input(z.object({ sessionId, deviceId: idSchema<'TransferDevice'>() }))
    .output(transferSessionSchema),
  cancelUpload: ipc
    .input(z.object({ sessionId, uploadId: idSchema<'TransferUpload'>() }))
    .output(transferFileSchema),
  /** The addresses a session could listen on, best first. */
  interfaces: ipc.output(
    z.array(z.object({ name: z.string().max(32), address: z.string().max(45) })).max(16),
  ),
  /** Settings → Privacy: every paired phone must pair again. */
  forgetDevices: ipc.output(z.object({ forgotten: count })),
  ...deviceProcedures,
};
