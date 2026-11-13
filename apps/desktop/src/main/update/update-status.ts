// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How each UpdateEvent moves Settings → About's update status (P2-X6, P3-B9): one small step per event type, pure.
 * host.ts keeps the state, publishes it and adds what only it knows (whether updates are on, the session); a step
 * says what the next status is and what the host remembers about the offer. Once an update is staged, later
 * checks, refusals and errors leave the "restart to update" status alone. (This module is in every release
 * bundle, which must not name the updater package: packaged.e2e.ts checks.)
 */
import { defineError, withoutDetail, type UpdateState } from '@taalcut/core';
import type { UpdateEvent } from './updater';

/**
 * The updater reported a failure. The message stays in the log, not the window.
 */
export const UpdateCheckFailed = defineError('desktop.update_check_failed', { retryable: true });

export type UpdateStatus = UpdateState['status'];

/** The release notes of the offer, already in the person's language (release-notes.ts). */
export interface OfferNotes {
  readonly notes?: string;
  readonly releaseDate?: number;
}

/** What the host remembers about the update on offer. */
export interface Offer {
  readonly version?: string;
  readonly notes: OfferNotes;
  /** The download is a delta (blockmap). */
  readonly delta: boolean;
}

export const NO_OFFER: Offer = { notes: {}, delta: false };

/** One event's effect: the offer afterwards and, when it changes, the next status. */
export interface StatusStep {
  readonly offer: Offer;
  readonly status?: UpdateStatus;
}

export interface StepContext {
  readonly state: UpdateState;
  readonly offer: Offer;
  readonly now: () => number;
}

type EventMap = { [E in UpdateEvent as E['type']]: E };
type Steps = { readonly [K in keyof EventMap]: (event: EventMap[K], context: StepContext) => StatusStep };

const unchanged = (offer: Offer): StatusStep => ({ offer });

/** `next`, unless an update is already staged. */
function unlessReady({ state, offer }: StepContext, next: UpdateStatus): StatusStep {
  return state.status.kind === 'ready' ? unchanged(offer) : { offer, status: next };
}

function downloading(offer: Offer, version: string, percent: number): UpdateStatus {
  return { kind: 'downloading', version, percent, ...(offer.delta ? { delta: true } : {}) };
}

/** A delta download started or fell back: the download in progress says which. */
function deltaStep({ state, offer }: StepContext, delta: boolean): StatusStep {
  const next = { ...offer, delta };
  if (state.status.kind !== 'downloading') return unchanged(next);
  return { offer: next, status: downloading(next, state.status.version, state.status.percent) };
}

const STEPS: Steps = {
  checking: (_event, context) => unlessReady(context, { kind: 'checking' }),
  'not-available': (_event, context) => unlessReady(context, { kind: 'idle', checkedAt: context.now() }),
  available: ({ version }, { offer }) => {
    const next: Offer = { version, notes: offer.version === version ? offer.notes : {}, delta: false };
    return { offer: next, status: downloading(next, version, 0) };
  },
  // start.ts translates the notes and hands them to the host (noteOffer).
  'release-info': (_event, { offer }) => unchanged(offer),
  delta: (_event, context) => deltaStep(context, true),
  'delta-failed': (_event, context) => deltaStep(context, false),
  progress: ({ percent }, { state, offer }) => {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    return { offer, status: downloading(offer, offer.version ?? state.version, clamped) };
  },
  downloaded: ({ version }, { offer }) => {
    const next = { ...offer, version };
    return { offer: next, status: downloading(next, version, 100) };
  },
  verified: ({ version }, { offer }) => unchanged({ ...offer, version }),
  staged: (_event, { offer }) =>
    offer.version === undefined
      ? unchanged(offer)
      : { offer, status: { kind: 'ready', version: offer.version, ...offer.notes } },
  rejected: ({ error }, context) => unlessReady(context, { kind: 'error', error: withoutDetail(error) }),
  error: (_event, context) => unlessReady(context, { kind: 'error', error: UpdateCheckFailed() }),
};

/** The key and the event apart, so the compiler pairs each step with its own event type. */
function step<K extends keyof EventMap>(type: K, event: EventMap[K], context: StepContext): StatusStep {
  return STEPS[type](event, context);
}

/** What `event` does to the status and the offer. */
export function stepStatus(event: UpdateEvent, context: StepContext): StatusStep {
  return step(event.type, event, context);
}
