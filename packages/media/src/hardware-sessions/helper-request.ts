// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Ties a hardware session lease to one request to a helper process (the mac helper's decode, grade or track):
 * the helper's pid goes into the lease's slot synchronously just before the request is sent, and the lease (with
 * that record) goes back when the helper lets go of the request: its answer or its exit (IX2-F4, IX3-F5, IX3-F7).
 * The idle helper is never named: only while a request may be in VideoToolbox. If this process dies before the
 * let-go (a quit or a crash), the slot stays until the helper exits; its idle exit bounds that.
 */
import { giveBack } from './runner';
import type { HardwareSessionLease } from './types';

export interface HelperRequestHold {
  readonly onSend?: (pid: number) => void;
  readonly onLetGo?: () => void;
}

export function helperRequestHold(
  lease: Pick<HardwareSessionLease, 'release' | 'adopt'> | null | undefined,
): HelperRequestHold {
  if (!lease) return {};
  return {
    onSend: (pid) => lease.adopt?.(pid),
    onLetGo: () => void giveBack(lease),
  };
}
