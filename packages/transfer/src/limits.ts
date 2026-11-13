// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The numbers in the transfer SPEC's Security section, in one place. */
export const TRANSFER_LIMITS = {
  maxFileBytes: 64 * 1024 * 1024 * 1024,
  reserveBytes: 2 * 1024 * 1024 * 1024,
  maxDevices: 5,
  concurrentPerDevice: 3,
  /** The phone uploads one file at a time. The device lab may raise this to 2. */
  parallelPerDevice: 1,
  /** One USB item at a time per device. The device lab may raise adb to 2. */
  usbParallelPerDevice: 1,
  /** Above this, listing refuses and the picker offers date ranges only. */
  usbMaxItems: 100_000,
  /** Item progress reaches a run file at most this often (run-level changes are written at once). */
  usbRunSaveIntervalMs: 2_000,
  maxFilesPerSession: 10_000,
  maxSockets: 64,
  /** One device (address) may hold this many of them (SB-17); a browser opens about 6 per host. */
  maxSocketsPerAddress: 16,
  /** While a request's body is incomplete, at least this much must arrive in each window, or the socket is cut. */
  slowBodyMinBytes: 64 * 1024,
  slowBodyWindowMs: 30_000,
  maxHeaderBytes: 16 * 1024,
  maxJsonBytes: 16 * 1024,
  maxMetadataBytes: 4 * 1024,
  apiPerMinute: 120,
  unauthPerMinute: 30,
  pairPerSecond: 1,
  pairFailuresBeforeReset: 5,
  /** A phone's request to pair (UX3): unanswered for this long, it lapses. */
  approvalTtlMs: 60_000,
  /** A phone that stopped asking how its request stands for this long has gone (closed the page, locked). */
  approvalAbandonMs: 10_000,
  /** How often the phone asks, and how often the computer looks for a lapsed or abandoned request. */
  approvalPollMs: 1_000,
  /** Requests a minute from one address. */
  approvalAsksPerMinute: 3,
  /** Polls and cancels a minute from one address (outside the 30-a-minute unauthenticated ceiling). */
  approvalWaitsPerMinute: 150,
  /** Requests a session remembers once settled, so a late answer finds out what happened. */
  approvalsKept: 20,
  idleMs: 10 * 60 * 1000,
  credentialTtlMs: 24 * 60 * 60 * 1000,
  partialTtlMs: 24 * 60 * 60 * 1000,
  socketIdleMs: 120_000,
  keepAliveMs: 5_000,
  headersTimeoutMs: 15_000,
  selfTestTimeoutMs: 2_000,
  /** At most 4 progress events a second per file. */
  progressMinIntervalMs: 250,
  postReceiveIntervalMs: 500,
  chunkSize: 32 * 1024 * 1024,
  lookupMaxFiles: 500,
  sniffBytes: 64 * 1024,
  portMin: 49_152,
  portMax: 65_535,
  importRetries: 3,
  maxNameBytes: 255,
} as const;
