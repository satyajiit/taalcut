// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Would you post this?" after an export (P2-X7): asked only while telemetry
 * is on, once per export. The answer is the window's own telemetry event
 * (`export.survey`, an enum and nothing else); which exports were asked stays
 * on this Mac.
 */
import { callRpc, type RenderId } from '@taalcut/core';
import type { CardSurvey } from '@taalcut/ui';
import { useMemo } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';

export const SURVEYED_KEY = 'taalcut.surveyed';
const MAX_KEPT = 200;

function surveyed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SURVEYED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === 'string') : [];
  } catch {
    return [];
  }
}

function remember(renderId: RenderId): void {
  try {
    const kept = [renderId, ...surveyed().filter((each) => each !== renderId)].slice(0, MAX_KEPT);
    localStorage.setItem(SURVEYED_KEY, JSON.stringify(kept));
  } catch {
    // Storage blocked: the question may come back after a reload, which is harmless.
  }
}

/** The survey's actions while telemetry is on; undefined (no question) otherwise. */
export function useExportSurvey(): CardSurvey | undefined {
  const backend = useBackend();
  const state = useRpcQuery((signal) => backend.telemetry.state(undefined, { signal }), [backend]);
  const enabled = state.data?.enabled === true;
  return useMemo<CardSurvey | undefined>(
    () =>
      enabled
        ? {
            asked: (renderId) => surveyed().includes(renderId),
            async answer(renderId, answer) {
              remember(renderId);
              return callRpc(backend.telemetry.record({ event: { name: 'export.survey', answer } }));
            },
          }
        : undefined,
    [backend, enabled],
  );
}
