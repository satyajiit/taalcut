// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  fromRpcError,
  type TaalcutError,
  type TransferApproval,
  type TransferFile,
  type TransferPairing,
  type TransferSession,
} from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';

export interface TransferState {
  readonly session: TransferSession | null;
  readonly pairing: TransferPairing | null;
  /** Uploads in the order they started. */
  readonly files: readonly TransferFile[];
  readonly error: TaalcutError | null;
}

/** What the hook holds: the state first run follows, and the latest phone asking to pair (UX3). */
interface HeldState extends TransferState {
  /** The latest phone's request to pair, as the stream or an answer last said; null until one asks. */
  readonly approval: TransferApproval | null;
}

const EMPTY: HeldState = { session: null, pairing: null, files: [], error: null, approval: null };

/** How often a screen stopped for want of a network looks for one (transfer SPEC, "Edge cases"). */
export const NETWORK_LOOK_MS = 5_000;

/**
 * The Wi-Fi import observer (P2-L3, LIB2): mounting
 * subscribes through `transfer.open`. Background observers leave reception with
 * main when they unmount; an explicitly closed session stops it. A LAN process
 * that restarted reopens once by itself, with a
 * new code and PIN (transfer SPEC, "Crash"). Stopped for want of a network,
 * it looks for an address every 5 s and starts again once one appears.
 * `enabled` false: nothing opens. LIB2 connects only after an explicit action.
 * `background` keeps main-owned reception alive when the observer unmounts; Stop still closes it.
 * A phone that scanned the QR asks to pair (UX3): `approval` is its latest request, and `answerApproval` is the
 * person's Allow or Deny; a new session starts with none.
 */
export function useTransferSession({
  enabled = true,
  background = false,
}: { enabled?: boolean; background?: boolean } = {}) {
  const backend = useBackend();
  const [state, setState] = useState<HeldState>(EMPTY);
  const [round, setRound] = useState(0);
  const sessionId = useRef<TransferSession['id'] | null>(null);
  /** The request an answer is for: the latest the stream sent. */
  const approvalId = useRef<TransferApproval['id'] | null>(null);
  const reopened = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setState(EMPTY);
    approvalId.current = null;
    if (!enabled) return;
    void (async () => {
      try {
        const stream = await backend.transfer.open({}, { signal: controller.signal });
        for await (const item of stream) {
          if (controller.signal.aborted) break;
          if (item.type === 'session') {
            sessionId.current = item.session.id;
            setState((prev) => ({
              ...prev,
              session: item.session,
              ...(item.pairing ? { pairing: item.pairing } : {}),
              error: null,
            }));
          } else if (item.type === 'approval') {
            approvalId.current = item.approval.id;
            setState((prev) => ({ ...prev, approval: item.approval }));
          } else {
            setState((prev) => {
              const known = prev.files.some((file) => file.id === item.file.id);
              return {
                ...prev,
                files: known
                  ? prev.files.map((file) => (file.id === item.file.id ? item.file : file))
                  : [...prev.files, item.file],
              };
            });
          }
        }
        // The stream ended without saying the session stopped (main went away): nothing listens any more.
        if (!controller.signal.aborted)
          setState((prev) =>
            prev.session && prev.session.state !== 'stopped'
              ? { ...prev, session: { ...prev.session, state: 'stopped' } }
              : prev,
          );
      } catch (cause) {
        if (controller.signal.aborted) return;
        const error = fromRpcError(cause);
        if (error.code === 'core.process_restarted' && !reopened.current) {
          reopened.current = true;
          setRound((n) => n + 1);
          return;
        }
        setState((prev) => ({ ...prev, error }));
      }
    })();
    return () => {
      controller.abort();
      // The app-root observer leaves reception with main. Embedded one-off flows retain their own lifetime.
      const id = sessionId.current;
      sessionId.current = null;
      if (id && !background) void callRpc(backend.transfer.close({ sessionId: id }));
    };
  }, [backend, round, enabled, background]);

  const restart = useCallback(() => {
    reopened.current = false;
    setRound((n) => n + 1);
  }, []);

  const offline = state.session?.state === 'stopped' && state.session.stopReason === 'no-network';
  useEffect(() => {
    if (!offline) return;
    let looking = false;
    const timer = setInterval(() => {
      if (looking) return;
      looking = true;
      void callRpc(backend.transfer.interfaces()).then((found) => {
        looking = false;
        if (found.ok && found.value.length > 0) restart();
      });
    }, NETWORK_LOOK_MS);
    return () => clearInterval(timer);
  }, [backend, offline, restart]);

  const stop = useCallback(async () => {
    const id = sessionId.current;
    if (id) await callRpc(backend.transfer.close({ sessionId: id }));
  }, [backend]);

  const newPairing = useCallback(async () => {
    const id = sessionId.current;
    if (!id) return;
    const result = await callRpc(backend.transfer.newPairing({ sessionId: id }));
    if (result.ok) setState((prev) => ({ ...prev, pairing: result.value }));
    return result;
  }, [backend]);

  /** Allow or Deny for the phone asking now; the request as it then stands replaces it. */
  const answerApproval = useCallback(
    async (allow: boolean) => {
      const id = sessionId.current;
      const asked = approvalId.current;
      if (!id || !asked) return;
      const result = await callRpc(
        backend.transfer.answerApproval({ sessionId: id, approvalId: asked, allow }),
      );
      // A newer request that arrived meanwhile stays: this answer was for the one before it.
      if (result.ok)
        setState((prev) =>
          prev.approval?.id === result.value.id ? { ...prev, approval: result.value } : prev,
        );
      return result;
    },
    [backend],
  );

  const disconnect = useCallback(
    async (deviceId: TransferSession['devices'][number]['id']) => {
      const id = sessionId.current;
      if (!id) return;
      const result = await callRpc(backend.transfer.disconnect({ sessionId: id, deviceId }));
      if (result.ok) setState((prev) => ({ ...prev, session: result.value }));
      return result;
    },
    [backend],
  );

  const cancelUpload = useCallback(
    async (uploadId: TransferFile['id']) => {
      const id = sessionId.current;
      if (!id) return;
      const result = await callRpc(backend.transfer.cancelUpload({ sessionId: id, uploadId }));
      if (result.ok)
        setState((prev) => ({
          ...prev,
          files: prev.files.map((file) => (file.id === result.value.id ? result.value : file)),
        }));
      return result;
    },
    [backend],
  );

  return { ...state, enabled, restart, stop, newPairing, answerApproval, disconnect, cancelUpload };
}

/** The session and what the screen can do with it. */
export type TransferSessionApi = ReturnType<typeof useTransferSession>;
