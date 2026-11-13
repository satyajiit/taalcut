// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UpdateState for Settings → About (P2-X6, P3-B9). Maps the UpdateEvent stream from updater.ts onto the updates
 * contract. No feed: status stays off and channel is null. The channel shown is the one in force (the baked one,
 * or a public build's chosen one); `choice` is the public channel (null on team builds); `lastRollback` is the
 * last automatic rollback on this Mac (rollback-notice.ts). A staged update carries its release notes in the
 * person's language and its date; a blockmap download says `delta`.
 */
import {
  defineError,
  latestValues,
  toRpcError,
  type PublicUpdateChannel,
  type UpdateChannel,
  type UpdateState,
} from '@taalcut/core';
import type { UpdateEvent } from './updater';
import { NO_OFFER, stepStatus, type Offer, type OfferNotes } from './update-status';

export { UpdateCheckFailed, type OfferNotes } from './update-status';

/**
 * installNow before an update is staged. (This module is in every release bundle, which must not name the
 * updater package: packaged.e2e.ts checks.)
 */
export const UpdateNotReady = defineError('desktop.update_not_ready');

export interface UpdateSession {
  checkNow(): Promise<void>;
  installNow(): void;
}

export interface UpdateHostOptions {
  readonly version: string;
  /** Baked channel. Forced to null when there is no feed. */
  readonly channel: UpdateChannel | null;
  /** False when this run has no feed. */
  readonly enabled: boolean;
  /** The public channel in force (UpdateState.choice); null or absent on team builds. */
  readonly choice?: PublicUpdateChannel | null;
  readonly clock?: () => number;
}

export interface UpdateHost {
  state(): UpdateState;
  changed(signal?: AbortSignal): AsyncGenerator<UpdateState>;
  check(): Promise<UpdateState>;
  installNow(): Promise<void>;
  apply(event: UpdateEvent): void;
  /** Called by startAutoUpdate once the feed is actually in use, and again when the person switches channel. */
  configure(options: UpdateHostOptions): void;
  /** The last automatic rollback on this Mac (rollback-notice.ts), shown by About. */
  noteRollback(rollback: UpdateState['lastRollback']): void;
  /** What start.ts read from the offer's release-info event, translated. */
  noteOffer(version: string, notes: OfferNotes): void;
  attach(session: UpdateSession): void;
}

let registered: UpdateHost | undefined;

/** The host the updates router is serving. startAutoUpdate adopts it. */
export function registeredUpdateHost(): UpdateHost | undefined {
  return registered;
}

export function registerUpdateHost(host: UpdateHost): void {
  registered = host;
}

function view(options: UpdateHostOptions): UpdateState {
  return {
    version: options.version,
    channel: options.enabled ? options.channel : null,
    choice: options.enabled ? (options.choice ?? null) : null,
    status: options.enabled ? { kind: 'idle' } : { kind: 'off' },
    lastRollback: null,
  };
}

export function createUpdateHost(options: UpdateHostOptions): UpdateHost {
  if (!options.version.trim()) throw new Error('update host needs a version');
  const clock = options.clock ?? Date.now;
  let current = view(options);
  let enabled = options.enabled;
  let offer: Offer = NO_OFFER;
  let session: UpdateSession | undefined;
  const listeners = new Set<(state: UpdateState) => void>();

  const publish = (next: UpdateState): void => {
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    current = next;
    for (const listener of listeners) listener(current);
  };

  /** The event's step (update-status.ts), unless updates are off. */
  const apply = (event: UpdateEvent): void => {
    if (!enabled || current.status.kind === 'off') return;
    const step = stepStatus(event, { state: current, offer, now: clock });
    offer = step.offer;
    if (step.status) publish({ ...current, status: step.status });
  };

  return {
    state: () => current,
    changed(signal?: AbortSignal): AsyncGenerator<UpdateState> {
      return latestValues(
        () => current,
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        signal,
      );
    },
    apply,
    noteRollback(rollback) {
      publish({ ...current, lastRollback: rollback });
    },
    noteOffer(version, notes) {
      if (version !== offer.version) return;
      offer = { ...offer, notes };
      // Translating can finish after Squirrel staged the update: the ready state gets them then.
      if (current.status.kind === 'ready' && current.status.version === version) {
        publish({ ...current, status: { kind: 'ready', version, ...notes } });
      }
    },
    configure(next) {
      if (!next.version.trim()) throw new Error('update host needs a version');
      enabled = next.enabled;
      const status = !next.enabled
        ? ({ kind: 'off' } as const)
        : current.status.kind === 'off'
          ? ({ kind: 'idle' } as const)
          : current.status;
      publish({
        ...current,
        version: next.version,
        channel: next.enabled ? next.channel : null,
        choice: next.enabled ? (next.choice ?? null) : null,
        status,
      });
    },
    attach(next) {
      session = next;
    },
    async check() {
      if (!enabled || !session) return current;
      await session.checkNow();
      return current;
    },
    async installNow() {
      if (current.status.kind !== 'ready' || !session) throw toRpcError(UpdateNotReady());
      session.installNow();
    },
  };
}
