// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One "I understand" on a warning card (PRD 10.1). */
export interface Acknowledgement {
  /** Which warning, e.g. 'subscription.claude' or 'instagram.saved' (REF1 retired the reel-download card's). */
  readonly topic: string;
  /** The version of the terms the user saw. A new version shows the card again. */
  readonly termsVersion: string;
  /** Epoch milliseconds. */
  readonly acknowledgedAt: number;
  readonly context?: unknown;
}

/**
 * Where acknowledgements live. The same shape as the library's
 * AcknowledgementRepository (packages/library), made async because the
 * renderer reaches it over IPC. The UI kit is given one; it never picks.
 */
export interface AcknowledgementStore {
  /** True when the user acknowledged exactly this terms version. */
  has(topic: string, termsVersion: string): Promise<boolean>;
  /** Records the acknowledgement. Recording the same pair again keeps the first record. */
  record(input: { topic: string; termsVersion: string; context?: unknown }): Promise<Acknowledgement>;
}

/** Keeps acknowledgements in memory: tests, stories and the fake client. */
export function memoryAcknowledgementStore(
  now: () => number = Date.now,
): AcknowledgementStore & { list(): Acknowledgement[] } {
  const records = new Map<string, Acknowledgement>();
  const key = (topic: string, version: string) => `${topic}\u0000${version}`;
  return {
    has: async (topic, termsVersion) => records.has(key(topic, termsVersion)),
    async record({ topic, termsVersion, context }) {
      const existing = records.get(key(topic, termsVersion));
      if (existing) return existing;
      const created: Acknowledgement = {
        topic,
        termsVersion,
        acknowledgedAt: now(),
        ...(context === undefined ? {} : { context }),
      };
      records.set(key(topic, termsVersion), created);
      return created;
    },
    list: () => [...records.values()],
  };
}

/**
 * Keeps acknowledgements in localStorage, for the browser preview. The
 * desktop app passes a store backed by the library's repository instead.
 */
export function localStorageAcknowledgementStore(
  storage: Storage = window.localStorage,
  storageKey = 'taalcut.acknowledgements',
  now: () => number = Date.now,
): AcknowledgementStore {
  const read = (): Acknowledgement[] => {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? '[]');
      return Array.isArray(parsed) ? (parsed as Acknowledgement[]) : [];
    } catch {
      return [];
    }
  };
  const find = (topic: string, termsVersion: string) =>
    read().find((record) => record.topic === topic && record.termsVersion === termsVersion);
  return {
    has: async (topic, termsVersion) => find(topic, termsVersion) !== undefined,
    async record({ topic, termsVersion, context }) {
      const existing = find(topic, termsVersion);
      if (existing) return existing;
      const created: Acknowledgement = {
        topic,
        termsVersion,
        acknowledgedAt: now(),
        ...(context === undefined ? {} : { context }),
      };
      try {
        storage.setItem(storageKey, JSON.stringify([...read(), created]));
      } catch {
        // Blocked storage: the acknowledgement lasts until reload.
      }
      return created;
    },
  };
}
