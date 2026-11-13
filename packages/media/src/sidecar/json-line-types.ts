// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The JSON-lines protocol's values, lines and request options (json-line.ts). */

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface JsonLineMessage {
  readonly type?: string;
  readonly id?: string;
  readonly service?: string;
  readonly name?: string;
  readonly data?: JsonValue;
  readonly ok?: boolean;
  readonly result?: JsonValue;
  readonly fraction?: number;
  readonly error?: { readonly code?: string; readonly message?: string; readonly retryable?: boolean };
}

export interface JsonLineRequestOptions {
  readonly signal?: AbortSignal;
  /** The most the request may take, whatever the helper says meanwhile (`media.timeout`). */
  readonly timeoutMs?: number;
  /**
   * Gives up when the helper says nothing about the request for this long (`media.timeout`): each `progress` line
   * for it starts the wait again (request-clock.ts). For a helper that sends a keepalive while it works (the mac
   * helper's OCR v2, FIX-OCRCOLD), so a request waits out a long compile but not a helper that went quiet.
   */
  readonly stallTimeoutMs?: number;
  readonly onNotification?: (message: JsonLineMessage) => void;
  /**
   * On abort or timeout, send the cancel and settle only when the helper answers it, not at once: the caller
   * holds what the request uses (a hardware session lease) until the helper has really let go of it.
   */
  readonly settleOnReply?: boolean;
  /**
   * With `settleOnReply`: how long to wait for that answer (default 2 minutes). A helper that never answers is
   * left alone, never signalled; the request then settles and says so once on the console.
   */
  readonly replyGraceMs?: number;
  /**
   * Runs once the helper has let go of the request (IX2-F4): its reply came (a cancel's included, however late),
   * its process exited, or the request was never sent. A cancel whose grace ran out settles the request first;
   * this still waits for the reply or the exit, so what the caller holds for the request (a hardware session
   * lease) is held as long as the helper may be using it.
   */
  readonly onLetGo?: () => void;
  /**
   * Called synchronously just before the request is written to the helper, with the helper's pid: what holds a
   * hardware session lease for the request records the pid there first, so a quit or a crash of this process
   * leaves the slot held while the helper may be in VideoToolbox (IX3-F7). Not called for a request never sent.
   */
  readonly onSend?: (pid: number) => void;
}
